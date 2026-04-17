"""Helpers for sandbox package installation with npm ENOSPC hardening."""

from __future__ import annotations

from dataclasses import dataclass
import shlex
from typing import Any

from agent.runtime.skill_dependencies import build_install_command

_NPM_ENOSPC_MARKERS = (
    "enospc",
    "tar_entry_error",
    "no space left on device",
)


@dataclass(frozen=True)
class PackageInstallResult:
    """Normalized package installation result for sandbox installs."""

    success: bool
    manager: str
    packages: tuple[str, ...]
    stdout: str
    stderr: str
    exit_code: int
    error_code: str | None = None
    retry_attempted: bool = False
    diagnostics: str | None = None

    @property
    def combined_output(self) -> str:
        return "\n".join(part for part in (self.stderr, self.stdout) if part).strip()

    @property
    def error_message(self) -> str:
        """Return a normalized, user-facing error message."""
        detail = self.combined_output or "unknown error"
        if self.error_code == "npm_enospc":
            lines = [
                "Installation failed (exit "
                f"{self.exit_code}): npm_enospc while installing "
                f"{' '.join(self.packages)}",
                f"retry_attempted={str(self.retry_attempted).lower()}",
            ]
            if self.diagnostics:
                lines.append(f"diagnostics:\n{self.diagnostics}")
            lines.append(detail)
            return "\n".join(lines)

        return f"Installation failed (exit {self.exit_code}): {detail}"


async def install_packages(
    session: Any,
    *,
    manager: str,
    packages: list[str] | tuple[str, ...],
    timeout: int = 120,
) -> PackageInstallResult:
    """Install validated packages inside a sandbox session."""
    package_tuple = tuple(packages)
    command = build_install_command(manager, list(package_tuple))

    if manager != "npm":
        exec_result = await session.exec(command, timeout=timeout)
        return PackageInstallResult(
            success=exec_result.success,
            manager=manager,
            packages=package_tuple,
            stdout=exec_result.stdout,
            stderr=exec_result.stderr,
            exit_code=getattr(exec_result, "exit_code", 0),
        )

    preflight = await _collect_npm_diagnostics(session)
    first_result = await session.exec(command, timeout=timeout)
    first_install = PackageInstallResult(
        success=first_result.success,
        manager=manager,
        packages=package_tuple,
        stdout=first_result.stdout,
        stderr=first_result.stderr,
        exit_code=getattr(first_result, "exit_code", 0),
        diagnostics=preflight,
    )
    if first_install.success or not _is_npm_enospc(first_install.combined_output):
        return first_install

    await _cleanup_npm_transient_state(session)
    retry_result = await session.exec(command, timeout=timeout)
    diagnostics = await _collect_npm_diagnostics(session, previous=preflight)
    return PackageInstallResult(
        success=retry_result.success,
        manager=manager,
        packages=package_tuple,
        stdout=retry_result.stdout,
        stderr=retry_result.stderr,
        exit_code=getattr(retry_result, "exit_code", 0),
        error_code="npm_enospc",
        retry_attempted=True,
        diagnostics=diagnostics,
    )


def _is_npm_enospc(output: str) -> bool:
    lowered = output.lower()
    return any(marker in lowered for marker in _NPM_ENOSPC_MARKERS)


async def _collect_npm_diagnostics(
    session: Any,
    *,
    previous: str | None = None,
) -> str:
    lines: list[str] = []
    if previous:
        lines.extend(["preflight:", previous, "", "post_failure:"])
    else:
        lines.append("preflight:")

    pwd_result = await session.exec("pwd", timeout=15)
    workdir = pwd_result.stdout.strip() if pwd_result.success else ""
    if workdir:
        lines.append(f"pwd={workdir}")

    df_result = await session.exec("df -Pk . /tmp 2>/dev/null || true", timeout=15)
    df_output = df_result.stdout.strip()
    if df_output:
        lines.append("df:")
        lines.append(df_output)

    cache_result = await session.exec(
        "npm config get cache 2>/dev/null || true",
        timeout=15,
    )
    cache_path = cache_result.stdout.strip()
    if cache_path:
        lines.append(f"npm_cache={cache_path}")
        quoted = shlex.quote(cache_path)
        cache_size_result = await session.exec(
            f"du -sh {quoted} 2>/dev/null || true",
            timeout=15,
        )
        cache_size = cache_size_result.stdout.strip()
        if cache_size:
            lines.append(f"npm_cache_size={cache_size}")

    return "\n".join(lines).strip()


async def _cleanup_npm_transient_state(session: Any) -> None:
    await session.exec("npm cache clean --force", timeout=60)
    await session.exec(
        "sh -lc 'rm -rf /tmp/npm-* /tmp/.npm-* /tmp/package-*'",
        timeout=30,
    )
