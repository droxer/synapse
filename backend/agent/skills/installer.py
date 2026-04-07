"""Skill installer — install skills from git repos, URLs, archives, or uploads."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass, replace
from pathlib import Path
from urllib.parse import urlparse

import httpx
from loguru import logger

from agent.skills.models import SkillCatalogEntry, SkillContent
from agent.skills.parser import parse_skill_md

_MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024  # 10 MB
_GIT_TIMEOUT = 30  # seconds


@dataclass(frozen=True)
class UploadedFile:
    """Represents a file uploaded by the user."""

    filename: str
    data: bytes


# Private/internal IP ranges that should be blocked to prevent SSRF
_BLOCKED_HOSTS = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "::1",
        "0.0.0.0",
        "169.254.169.254",  # cloud metadata
        "metadata.google.internal",
    }
)


class SkillInstaller:
    """Installs, uninstalls, and lists user-installed skills."""

    def __init__(self, install_dir: str | None = None) -> None:
        self._install_dir = install_dir or os.path.join(
            str(Path.home()), ".synapse", "skills"
        )
        os.makedirs(self._install_dir, exist_ok=True)

    @property
    def install_dir(self) -> str:
        return self._install_dir

    async def install_from_git(
        self,
        repo_url: str,
        skill_path: str | None = None,
    ) -> SkillContent:
        """Clone a git repo and install a skill from it.

        Parameters
        ----------
        repo_url:
            HTTPS git URL (e.g. https://github.com/user/repo.git).
        skill_path:
            Optional subdirectory within the repo containing the SKILL.md.
            If None, the repo root is assumed.

        Returns
        -------
        The installed SkillContent.

        Raises
        ------
        ValueError for invalid URLs or missing SKILL.md.
        RuntimeError for git clone failures.
        """
        _validate_https_url(repo_url)
        _validate_not_internal(repo_url)

        with tempfile.TemporaryDirectory() as tmp_dir:
            clone_dir = os.path.join(tmp_dir, "repo")
            try:
                subprocess.run(
                    ["git", "clone", "--depth", "1", "--", repo_url, clone_dir],
                    check=True,
                    capture_output=True,
                    timeout=_GIT_TIMEOUT,
                )
            except FileNotFoundError as exc:
                raise RuntimeError("git is not installed or not found on PATH") from exc
            except subprocess.TimeoutExpired as exc:
                raise RuntimeError(
                    f"Git clone timed out after {_GIT_TIMEOUT}s"
                ) from exc
            except subprocess.CalledProcessError as exc:
                raise RuntimeError(
                    f"Git clone failed: {exc.stderr.decode(errors='replace')}"
                ) from exc

            # Locate SKILL.md
            skill_dir = clone_dir
            if skill_path:
                skill_dir = os.path.join(clone_dir, skill_path)

            skill_file = os.path.join(skill_dir, "SKILL.md")
            if not os.path.isfile(skill_file):
                raise ValueError(f"SKILL.md not found at {skill_path or 'repo root'}")

            skill = parse_skill_md(skill_file)
            return self._install_skill_dir(skill_dir, skill)

    async def install_from_url(self, url: str) -> SkillContent:
        """Download a SKILL.md or archive from a URL and install it.

        Supports direct SKILL.md files and .zip archives.

        Raises
        ------
        ValueError for invalid URLs or content.
        RuntimeError for download failures.
        """
        _validate_https_url(url)
        _validate_not_internal(url)

        timeout = httpx.Timeout(connect=10.0, read=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Use streaming to avoid OOM on large responses
            async with client.stream("GET", url, follow_redirects=True) as response:
                # SSRF: validate the final URL after redirects
                final_url = str(response.url)
                _validate_https_url(final_url)
                _validate_not_internal(final_url)

                response.raise_for_status()

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > _MAX_DOWNLOAD_SIZE:
                        raise ValueError(
                            f"Download too large: >{_MAX_DOWNLOAD_SIZE} bytes"
                        )
                    chunks.append(chunk)

            content = b"".join(chunks)

        # Detect zip by magic bytes (PK signature) rather than URL extension,
        # so a server cannot trick us by serving a zip at a .md URL or vice versa.
        is_zip = content[:2] == b"PK"

        # Content-type validation for non-zip downloads
        if not is_zip:
            content_type = response.headers.get("content-type", "")
            if content_type and not content_type.startswith(
                ("text/", "application/octet-stream")
            ):
                raise ValueError(
                    f"Expected text content for SKILL.md, got: {content_type}"
                )

        with tempfile.TemporaryDirectory() as tmp_dir:
            if is_zip:
                archive_path = os.path.join(tmp_dir, "skill.zip")
                with open(archive_path, "wb") as f:
                    f.write(content)

                extract_dir = os.path.join(tmp_dir, "extracted")
                _safe_extract_zip(archive_path, extract_dir)

                # Find SKILL.md in extracted content
                skill_file = _find_skill_md(extract_dir)
                if not skill_file:
                    raise ValueError("No SKILL.md found in archive")

                skill = parse_skill_md(skill_file)
                return self._install_skill_dir(os.path.dirname(skill_file), skill)

            # Assume direct SKILL.md file
            skill_dir = os.path.join(tmp_dir, "skill")
            os.makedirs(skill_dir, exist_ok=True)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            with open(skill_file, "w", encoding="utf-8") as f:
                f.write(content.decode("utf-8"))

            skill = parse_skill_md(skill_file)
            return self._install_skill_dir(skill_dir, skill)

    def uninstall(self, name: str) -> bool:
        """Remove an installed skill by name. Returns True if removed."""
        name = _sanitize_name(name)
        target = os.path.join(self._install_dir, name)
        if os.path.isdir(target):
            shutil.rmtree(target)
            logger.info("Uninstalled skill '{}'", name)
            return True
        return False

    def list_installed(self) -> tuple[SkillCatalogEntry, ...]:
        """List all user-installed skills."""
        entries: list[SkillCatalogEntry] = []

        if not os.path.isdir(self._install_dir):
            return ()

        for entry_name in sorted(os.listdir(self._install_dir)):
            skill_dir = os.path.join(self._install_dir, entry_name)
            skill_file = os.path.join(skill_dir, "SKILL.md")
            if not os.path.isfile(skill_file):
                continue
            try:
                skill = parse_skill_md(skill_file)
                entries.append(
                    SkillCatalogEntry(
                        name=skill.metadata.name,
                        description=skill.metadata.description,
                    )
                )
            except Exception as exc:
                logger.error("Failed to parse installed skill {}: {}", entry_name, exc)

        return tuple(entries)

    async def install_from_upload(
        self,
        files: list[UploadedFile],
    ) -> SkillContent:
        """Install a skill from uploaded files.

        Accepts:
        - A single .zip file → extract and find SKILL.md
        - A single SKILL.md file → install directly
        - Multiple files (folder upload) → write all preserving relative paths, find SKILL.md

        Raises
        ------
        ValueError for invalid uploads, missing SKILL.md, or path traversal.
        """
        if not files:
            raise ValueError("No files uploaded")

        # Validate total size
        total_size = sum(len(f.data) for f in files)
        if total_size > _MAX_DOWNLOAD_SIZE:
            raise ValueError(
                f"Upload too large: {total_size} bytes exceeds {_MAX_DOWNLOAD_SIZE} byte limit"
            )

        # Sanitize all filenames
        for f in files:
            _validate_upload_filename(f.filename)

        with tempfile.TemporaryDirectory() as tmp_dir:
            if len(files) == 1 and files[0].filename.lower().endswith(".zip"):
                # Single zip file
                archive_path = os.path.join(tmp_dir, "upload.zip")
                with open(archive_path, "wb") as fh:
                    fh.write(files[0].data)

                extract_dir = os.path.join(tmp_dir, "extracted")
                _safe_extract_zip(archive_path, extract_dir)

                skill_file = _find_skill_md(extract_dir)
                if not skill_file:
                    raise ValueError("No SKILL.md found in uploaded zip")

                skill = parse_skill_md(skill_file)
                return self._install_skill_dir(os.path.dirname(skill_file), skill)

            if (
                len(files) == 1
                and os.path.basename(files[0].filename).upper() == "SKILL.MD"
            ):
                # Single SKILL.md file
                skill_dir = os.path.join(tmp_dir, "skill")
                os.makedirs(skill_dir, exist_ok=True)
                skill_file = os.path.join(skill_dir, "SKILL.md")
                with open(skill_file, "w", encoding="utf-8") as fh:
                    fh.write(files[0].data.decode("utf-8"))

                skill = parse_skill_md(skill_file)
                return self._install_skill_dir(skill_dir, skill)

            # Multiple files (folder upload)
            upload_dir = os.path.join(tmp_dir, "upload")
            os.makedirs(upload_dir, exist_ok=True)
            real_upload_dir = os.path.realpath(upload_dir)

            for f in files:
                target_path = os.path.realpath(os.path.join(upload_dir, f.filename))
                if (
                    not target_path.startswith(real_upload_dir + os.sep)
                    and target_path != real_upload_dir
                ):
                    raise ValueError(
                        f"Path traversal detected in filename: {f.filename}"
                    )
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, "wb") as fh:
                    fh.write(f.data)

            skill_file = _find_skill_md(upload_dir)
            if not skill_file:
                raise ValueError("No SKILL.md found in uploaded files")

            skill = parse_skill_md(skill_file)
            return self._install_skill_dir(os.path.dirname(skill_file), skill)

    def _install_skill_dir(self, source_dir: str, skill: SkillContent) -> SkillContent:
        """Copy a skill directory into the install location."""
        name = _sanitize_name(skill.metadata.name)
        target = os.path.join(self._install_dir, name)

        # Remove existing if present
        if os.path.exists(target):
            shutil.rmtree(target)

        shutil.copytree(source_dir, target, ignore=shutil.ignore_patterns(".git"))
        logger.info("Installed skill '{}' to {}", name, target)

        # Re-parse from installed location and tag as user-installed
        installed = parse_skill_md(os.path.join(target, "SKILL.md"))
        return replace(installed, source_type="user")


def _validate_https_url(url: str) -> None:
    """Validate that a URL uses HTTPS."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Only HTTPS URLs are allowed, got: {parsed.scheme}")
    if not parsed.netloc:
        raise ValueError("Invalid URL: no host specified")


def _validate_not_internal(url: str) -> None:
    """Reject URLs pointing to internal/metadata services (SSRF prevention)."""
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower().strip("[]")  # strip IPv6 brackets

    if hostname in _BLOCKED_HOSTS:
        raise ValueError(f"URL points to a blocked internal host: {hostname}")

    # Block IPv4 private ranges (10.x, 172.16-31.x, 192.168.x)
    if hostname.startswith(("10.", "192.168.")):
        raise ValueError(f"URL points to a private IP address: {hostname}")
    if hostname.startswith("172."):
        parts = hostname.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            second_octet = int(parts[1])
            if 16 <= second_octet <= 31:
                raise ValueError(f"URL points to a private IP address: {hostname}")

    # Block RFC 6598 shared address space (100.64.0.0/10)
    if hostname.startswith("100."):
        parts = hostname.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            second_octet = int(parts[1])
            if 64 <= second_octet <= 127:
                raise ValueError(f"URL points to a shared address space IP: {hostname}")

    # Block IPv6 loopback/link-local/unique-local
    ipv6_blocked_prefixes = (
        "::1",  # loopback
        "fe80:",  # link-local
        "fc",  # unique local fc00::/7
        "fd",  # unique local fd00::/7
        "::ffff:",  # IPv4-mapped (::ffff:10.x, ::ffff:127.x, etc.)
    )
    if any(hostname.startswith(p) for p in ipv6_blocked_prefixes):
        raise ValueError(f"URL points to a blocked IPv6 address: {hostname}")


def _safe_extract_zip(archive_path: str, extract_dir: str) -> None:
    """Extract a zip file, rejecting entries with path traversal (Zip Slip)."""
    os.makedirs(extract_dir, exist_ok=True)
    real_extract_dir = os.path.realpath(extract_dir)

    with zipfile.ZipFile(archive_path, "r") as zf:
        for member in zf.namelist():
            target = os.path.realpath(os.path.join(extract_dir, member))
            if (
                not target.startswith(real_extract_dir + os.sep)
                and target != real_extract_dir
            ):
                raise ValueError(f"Zip contains path traversal entry: {member}")
        zf.extractall(extract_dir)


def _sanitize_name(name: str) -> str:
    """Sanitize a skill name for use as a directory name."""
    # Allow only alphanumeric and hyphens
    sanitized = "".join(c if c.isalnum() or c == "-" else "-" for c in name)
    return sanitized.strip("-") or "unnamed-skill"


def _validate_upload_filename(filename: str) -> None:
    """Reject filenames with path traversal or unsafe characters."""
    if not filename:
        raise ValueError("Empty filename")
    # Reject absolute paths
    if os.path.isabs(filename):
        raise ValueError(f"Absolute path not allowed: {filename}")
    # Reject path traversal components
    parts = Path(filename).parts
    if ".." in parts:
        raise ValueError(f"Path traversal detected in filename: {filename}")
    # Reject null bytes
    if "\x00" in filename:
        raise ValueError(f"Null byte in filename: {filename}")


def _find_skill_md(root: str) -> str | None:
    """Find the SKILL.md file closest to root. Errors if multiple found at same depth."""
    matches: list[tuple[int, str]] = []
    for dirpath, _dirs, files in os.walk(root):
        if "SKILL.md" in files:
            depth = dirpath.replace(root, "").count(os.sep)
            matches.append((depth, os.path.join(dirpath, "SKILL.md")))

    if not matches:
        return None

    matches.sort(key=lambda x: x[0])
    min_depth = matches[0][0]
    top_level = [path for depth, path in matches if depth == min_depth]

    if len(top_level) > 1:
        raise ValueError(
            f"Archive contains multiple SKILL.md files at the same level: "
            f"{', '.join(top_level)}"
        )

    return top_level[0]
