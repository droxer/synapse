"""Local subprocess sandbox provider for development.

Executes commands directly on the host machine using asyncio subprocess.
No Docker required. Suitable for local development only — NOT for production.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from pathlib import Path

from loguru import logger

from agent.sandbox.base import (
    SANDBOX_HOME_DIR,
    ExecResult,
    SandboxConfig,
    SandboxProvider,
    SandboxSession,
)

_DEFAULT_WORKDIR = "/tmp/synapse-workspace"
_SANDBOX_WORKSPACE_DIR = "/workspace"


class LocalSession:
    """A sandbox session that runs commands locally via subprocess.

    Implements the SandboxSession protocol. Uses a dedicated workspace
    directory to isolate file operations.
    """

    def __init__(self, workdir: str) -> None:
        self._workdir = workdir
        self._closed = False

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Execute a shell command via asyncio subprocess."""
        if self._closed:
            raise RuntimeError("Session is closed")

        effective_timeout = timeout or 30

        try:
            effective_workdir = (
                str(self._resolve_path(workdir)) if workdir else self._workdir
            )
            proc = await asyncio.create_subprocess_shell(
                command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=effective_workdir,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(),
                timeout=effective_timeout,
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return ExecResult(
                stdout="",
                stderr=f"Command timed out after {effective_timeout}s",
                exit_code=124,
            )
        except Exception as exc:
            return ExecResult(
                stdout="",
                stderr=str(exc),
                exit_code=1,
            )

        return ExecResult(
            stdout=(stdout_bytes or b"").decode("utf-8", errors="replace"),
            stderr=(stderr_bytes or b"").decode("utf-8", errors="replace"),
            exit_code=proc.returncode or 0,
        )

    async def read_file(self, path: str) -> str:
        """Read file content from the workspace."""
        resolved = self._resolve_path(path)
        try:
            return resolved.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise FileNotFoundError(f"File not found: {path}") from None
        except Exception as exc:
            raise RuntimeError(f"Failed to read {path}: {exc}") from exc

    async def write_file(self, path: str, content: str) -> None:
        """Write content to a file, creating parent directories as needed."""
        resolved = self._resolve_path(path)
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(content, encoding="utf-8")

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        """Copy a file from host into the target path.

        Absolute sandbox paths are mapped into the local workspace so file
        tools behave like BoxLite/E2B during development.
        """
        if not os.path.isfile(local_path):
            raise FileNotFoundError(f"Local file not found: {local_path}")
        target = self._resolve_path(remote_path)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(local_path, target)

    async def download_file(self, remote_path: str, local_path: str) -> None:
        """Copy a file from the workspace to a host path."""
        resolved = self._resolve_path(remote_path)
        if not resolved.is_file():
            raise FileNotFoundError(f"File not found in workspace: {remote_path}")
        local_dir = os.path.dirname(local_path)
        if local_dir:
            os.makedirs(local_dir, exist_ok=True)
        shutil.copy2(resolved, local_path)

    async def close(self) -> None:
        """Mark session as closed. Workspace is preserved for inspection."""
        self._closed = True
        logger.info("Local sandbox session closed (workdir={})", self._workdir)

    def _resolve_path(self, path: str) -> Path:
        """Resolve a path and verify it stays within the workspace directory.

        Raises:
            ValueError: If the resolved path escapes the workspace boundary.
        """
        workdir = Path(self._workdir).resolve()
        if os.path.isabs(path):
            sandbox_roots = (SANDBOX_HOME_DIR, _SANDBOX_WORKSPACE_DIR)
            mapped: Path | None = None
            for root in sandbox_roots:
                if path == root:
                    mapped = workdir
                    break
                prefix = f"{root}/"
                if path.startswith(prefix):
                    mapped = (workdir / path[len(prefix) :]).resolve()
                    break
            if mapped is None:
                raise ValueError(
                    f"Path '{path}' is outside the sandbox roots "
                    f"'{SANDBOX_HOME_DIR}' and '{_SANDBOX_WORKSPACE_DIR}'"
                )
            resolved = mapped
        else:
            resolved = (workdir / path).resolve()

        # Enforce workspace containment — reject any path that escapes
        try:
            resolved.relative_to(workdir)
        except ValueError:
            raise ValueError(
                f"Path '{path}' escapes the workspace boundary '{workdir}'"
            )

        return resolved


class LocalProvider(SandboxProvider):
    """Sandbox provider that executes directly on the host via subprocess.

    Creates a workspace directory per session. Suitable for local development.
    """

    def __init__(self, base_workdir: str = _DEFAULT_WORKDIR) -> None:
        self._base_workdir = base_workdir

    async def create_session(self, config: SandboxConfig) -> LocalSession:
        """Create a local session with its own unique workspace directory."""
        workdir = os.path.join(
            self._base_workdir, config.template, uuid.uuid4().hex[:8]
        )
        os.makedirs(workdir, exist_ok=True)
        logger.info(
            "Created local sandbox session (template=%s, workdir=%s)",
            config.template,
            workdir,
        )
        return LocalSession(workdir=workdir)

    async def destroy_session(self, session: SandboxSession) -> None:
        """Close the session (idempotent)."""
        await session.close()
