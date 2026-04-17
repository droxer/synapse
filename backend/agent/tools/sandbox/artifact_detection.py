"""Shared artifact auto-detection for sandbox tools.

Scans sandbox directories for newly created output files after tool
execution.  Used by ``code_run`` and ``shell_exec`` to discover
artifacts the LLM forgot to list explicitly.
"""

from __future__ import annotations

import os
import re
import shlex
from typing import Any

from agent.sandbox.base import SANDBOX_HOME_DIR
from agent.tools.sandbox.constants import ARTIFACT_EXTENSIONS

# Directories scanned for auto-detected output files.
# /workspace is a symlink to SANDBOX_HOME_DIR but some ``find``
# implementations don't follow symlinks for starting points, so we
# list both.  Skills stage resources under ~/skills/ and code_run
# scripts may write to /tmp, so include those too.
_SKILL_DIR = f"{SANDBOX_HOME_DIR}/skills"
# Staged skill copies live here; auto-detection must not treat them as user outputs.
_SKILL_ROOT_PREFIX = f"{_SKILL_DIR}/"
DEFAULT_SEARCH_ROOTS: tuple[str, ...] = ("/workspace", _SKILL_DIR)

# When the model does not pass output_files, skip plain-text and structured-text
# outputs from auto-detection — they are usually outlines or build logs, not the
# final deliverable (e.g. .pptx / .pdf / images).
_AUTO_DETECT_SKIP_EXTENSIONS = frozenset({".txt", ".md", ".json", ".xml"})

ArtifactSnapshot = dict[str, tuple[int, str]]
_TEXT_PATH_PATTERN = re.compile(r"(/[^\s\"'<>]+)")
_TRAILING_PATH_PUNCTUATION = ".,;:!?)]}>\"'"


def _build_find_name_clauses() -> str:
    return " -o ".join(
        f"-name {shlex.quote('*' + ext)}" for ext in sorted(ARTIFACT_EXTENSIONS)
    )


def _build_find_roots(search_roots: tuple[str, ...]) -> str:
    return " ".join(shlex.quote(r) for r in search_roots)


def _is_under_prefixes(path: str, prefixes: tuple[str, ...]) -> bool:
    normalized = _normalize_prefixes(prefixes)
    normalized_path = path.rstrip("/")
    return any(
        normalized_path == prefix or normalized_path.startswith(f"{prefix}/")
        for prefix in normalized
    )


def _clean_text_candidate_path(raw: str) -> str:
    candidate = raw.strip()
    while candidate and candidate[-1] in _TRAILING_PATH_PUNCTUATION:
        candidate = candidate[:-1]
    return candidate


def extract_artifact_paths_from_text(
    text: str,
    *,
    search_roots: tuple[str, ...] = DEFAULT_SEARCH_ROOTS,
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """Extract artifact-like absolute paths from tool output text.

    This is a constrained fallback for tool output only. It recognizes
    absolute sandbox paths ending in known artifact extensions and only
    keeps paths under the configured search roots or the active workdir.
    """
    if not text.strip():
        return []

    candidate_prefixes = tuple(
        dict.fromkeys(
            [
                *search_roots,
                *_normalize_prefixes(allow_prefixes),
            ]
        )
    )
    out: list[str] = []
    seen: set[str] = set()

    for match in _TEXT_PATH_PATTERN.finditer(text):
        path = _clean_text_candidate_path(match.group(1))
        if not path or path in seen:
            continue
        _, ext = os.path.splitext(path)
        if ext.lower() not in ARTIFACT_EXTENSIONS:
            continue
        if not _is_under_prefixes(path, candidate_prefixes):
            continue
        seen.add(path)
        out.append(path)

    return _filter_auto_detected_paths(out, allow_prefixes=allow_prefixes)


async def snapshot_output_files(
    session: Any,
    *,
    search_roots: tuple[str, ...] = DEFAULT_SEARCH_ROOTS,
) -> ArtifactSnapshot:
    """Return current artifact candidates keyed by path.

    Snapshot values combine file size and mtime so callers can detect
    newly created files and files rewritten too quickly for ``find -newer``
    to notice on coarse-timestamp filesystems.
    """
    try:
        from agent.sandbox.base import ExecResult

        name_clauses = _build_find_name_clauses()
        roots = _build_find_roots(search_roots)
        find_cmd = (
            f"find {roots} -type f \\( {name_clauses} \\) "
            "-printf '%p\\t%s\\t%T@\\n' 2>/dev/null"
        )
        result = await session.exec(find_cmd)
        if not isinstance(result, ExecResult):
            return {}
        if not result.success or not result.stdout.strip():
            return {}

        snapshot: ArtifactSnapshot = {}
        for line in result.stdout.splitlines():
            path, sep, rest = line.partition("\t")
            if not sep:
                continue
            size_text, sep, mtime = rest.partition("\t")
            if not sep:
                continue
            try:
                snapshot[path.strip()] = (int(size_text.strip()), mtime.strip())
            except ValueError:
                continue
        return snapshot
    except Exception:
        return {}


async def find_new_output_files(
    session: Any,
    ts_marker: str,
    *,
    exclude_paths: tuple[str, ...] = (),
    search_roots: tuple[str, ...] = DEFAULT_SEARCH_ROOTS,
    before_snapshot: ArtifactSnapshot | None = None,
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """Return paths of output-type files created after *ts_marker*.

    Scans *search_roots* for files with extensions in
    ``ARTIFACT_EXTENSIONS`` that are newer than the timestamp marker.
    Returns an empty list on any error so failures never break the
    main flow.

    Args:
        session: An active sandbox session.
        ts_marker: Path to a marker file touched before execution.
        exclude_paths: Paths (basenames) to exclude from results.
        search_roots: Directories to scan.
        allow_prefixes: Directory prefixes that should still be treated as
            candidate deliverables even when they live under the staged skill
            root. This allows commands executed inside an active skill
            directory to emit final outputs without exposing unrelated staged
            skill assets.
    """
    try:
        from agent.sandbox.base import ExecResult

        name_clauses = _build_find_name_clauses()
        roots = _build_find_roots(search_roots)
        find_cmd = (
            f"find {roots} -newer {shlex.quote(ts_marker)} -type f "
            f"\\( {name_clauses} \\) 2>/dev/null"
        )

        find_result = await session.exec(find_cmd)
        if not isinstance(find_result, ExecResult):
            return []
        if not find_result.success:
            return []

        exclude_basenames = frozenset(os.path.basename(p) for p in exclude_paths)
        candidates = [
            p.strip()
            for p in find_result.stdout.strip().splitlines()
            if p.strip() and os.path.basename(p.strip()) not in exclude_basenames
        ]

        if before_snapshot is not None:
            after_snapshot = await snapshot_output_files(
                session,
                search_roots=search_roots,
            )
            for path, fingerprint in after_snapshot.items():
                if os.path.basename(path) in exclude_basenames:
                    continue
                if path in exclude_paths:
                    continue
                if before_snapshot.get(path) != fingerprint:
                    candidates.append(path)

        seen: set[str] = set()
        result: list[str] = []
        for path in candidates:
            if path in seen:
                continue
            seen.add(path)
            result.append(path)
        return _filter_auto_detected_paths(result, allow_prefixes=allow_prefixes)
    except Exception:
        return []


async def _path_exists(session: Any, path: str) -> bool:
    """Return True when *path* exists as a regular file in the sandbox."""
    try:
        from agent.sandbox.base import ExecResult

        result = await session.exec(f"test -f {shlex.quote(path)}")
        return isinstance(result, ExecResult) and result.success
    except Exception:
        return False


def _normalize_prefixes(prefixes: tuple[str, ...]) -> tuple[str, ...]:
    normalized: list[str] = []
    for raw in prefixes:
        prefix = raw.strip()
        if not prefix:
            continue
        normalized.append(prefix.rstrip("/"))
    return tuple(normalized)


def _is_allowed_skill_output(path: str, allow_prefixes: tuple[str, ...]) -> bool:
    normalized_path = path.rstrip("/")
    for prefix in _normalize_prefixes(allow_prefixes):
        if normalized_path == prefix or normalized_path.startswith(f"{prefix}/"):
            return True
    return False


def _filter_auto_detected_paths(
    paths: list[str],
    *,
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """Drop paths that are almost never the user's final deliverable."""
    out: list[str] = []
    seen: set[str] = set()
    for raw in paths:
        path = raw.strip()
        if not path or path in seen:
            continue
        if path.startswith(_SKILL_ROOT_PREFIX) and not _is_allowed_skill_output(
            path, allow_prefixes
        ):
            continue
        _, ext = os.path.splitext(path)
        if ext.lower() in _AUTO_DETECT_SKIP_EXTENSIONS:
            continue
        seen.add(path)
        out.append(path)
    return out


def build_artifact_paths(
    explicit: list[str],
    auto_found: list[str],
    *,
    exclude_paths: tuple[str, ...] = (),
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """Resolve artifact paths for sandbox extraction.

    When *explicit* is non-empty (e.g. ``output_files`` from the model), only
    those paths are used — auto-detection is ignored so intermediate files
    (another export in the same run, staged skill assets, etc.) are not shown.

    When *explicit* is empty, *auto_found* is used after filtering out staged
    skill files and common text intermediates. ``allow_prefixes`` keeps the
    active command workdir eligible even when it lives under the staged skill
    tree.
    """
    exclude_basenames = frozenset(os.path.basename(p) for p in exclude_paths)

    def _passes_excludes(p: str) -> bool:
        return os.path.basename(p) not in exclude_basenames and p not in exclude_paths

    explicit_clean: list[str] = []
    seen_exp: set[str] = set()
    for path in explicit:
        path = path.strip()
        if not path or path in seen_exp:
            continue
        if not _passes_excludes(path):
            continue
        seen_exp.add(path)
        explicit_clean.append(path)

    if explicit_clean:
        return explicit_clean

    seen: set[str] = set()
    result: list[str] = []
    for path in _filter_auto_detected_paths(
        auto_found,
        allow_prefixes=allow_prefixes,
    ):
        if path in seen:
            continue
        if not _passes_excludes(path):
            continue
        seen.add(path)
        result.append(path)

    return result


async def resolve_artifact_paths(
    session: Any,
    explicit: list[str],
    auto_found: list[str],
    *,
    exclude_paths: tuple[str, ...] = (),
    allow_prefixes: tuple[str, ...] = (),
) -> list[str]:
    """Prefer explicit artifact paths when they exist, otherwise fall back.

    This keeps the current contract that explicit ``output_files`` win over
    auto-detection, but avoids emitting dead artifact references when the model
    names a file path that was never actually written.
    """
    explicit_clean = build_artifact_paths(
        explicit,
        [],
        exclude_paths=exclude_paths,
    )
    if explicit_clean:
        existing = [
            path for path in explicit_clean if await _path_exists(session, path)
        ]
        if existing:
            return existing

    return build_artifact_paths(
        [],
        auto_found,
        exclude_paths=exclude_paths,
        allow_prefixes=allow_prefixes,
    )
