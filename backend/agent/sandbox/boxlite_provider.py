"""Boxlite sandbox provider — micro-VM sandbox backend for HiAgent.

Uses the Boxlite Python SDK to create hardware-isolated micro-VMs
with separate kernels per sandbox instance. Each sandbox gets its own
Linux VM boundary, preventing guest access to the host filesystem.

See: https://docs.boxlite.ai/reference/python/box-types
"""

from __future__ import annotations

import asyncio
import os
import shlex
import tempfile

import boxlite

from loguru import logger

from agent.sandbox.base import (
    SANDBOX_HOME_DIR,
    ExecResult,
    SandboxConfig,
    SandboxProvider,
    SandboxSession,
)

# ---------------------------------------------------------------------------
# Template -> OCI image mapping
# ---------------------------------------------------------------------------

TEMPLATE_IMAGES: dict[str, str] = {
    "default": "ghcr.io/droxer/hiagent-sandbox-default",
    "data_science": "ghcr.io/droxer/hiagent-sandbox-data-science",
    "browser": "ghcr.io/droxer/hiagent-sandbox-browser",
}

DEFAULT_IMAGE = "ghcr.io/droxer/hiagent-sandbox-default"


# ---------------------------------------------------------------------------
# BoxliteSession
# ---------------------------------------------------------------------------


class BoxliteSession:
    """A live sandbox session backed by a Boxlite micro-VM.

    Implements the ``SandboxSession`` protocol.  Uses the Boxlite
    ``SimpleBox`` under the hood, which provides hardware-level
    isolation with a separate kernel per instance.
    """

    def __init__(self, box: boxlite.SimpleBox, workdir: str = SANDBOX_HOME_DIR) -> None:
        self._box = box
        self._workdir = workdir

    # -- command execution ---------------------------------------------------

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Run *command* inside the micro-VM and return an ``ExecResult``.

        The command is executed via ``sh -c`` to support shell features
        like pipes, redirects, and chaining.
        """
        effective_workdir = workdir or self._workdir

        try:
            # Use sh -c to support full shell syntax
            coro = self._box.exec(
                "sh",
                "-c",
                f"cd {shlex.quote(effective_workdir)} && {command}",
            )
            if timeout is not None:
                result = await asyncio.wait_for(coro, timeout=timeout)
            else:
                result = await coro
        except asyncio.TimeoutError:
            return ExecResult(
                stdout="",
                stderr=f"Command timed out after {timeout}s",
                exit_code=124,
            )
        except boxlite.TimeoutError:
            return ExecResult(
                stdout="",
                stderr="Boxlite execution timeout exceeded",
                exit_code=124,
            )
        except boxlite.ResourceError as exc:
            return ExecResult(
                stdout="",
                stderr=f"Resource limit exceeded: {exc}",
                exit_code=137,
            )

        return ExecResult(
            stdout=result.stdout or "",
            stderr=result.stderr or "",
            exit_code=result.exit_code,
        )

    # -- file operations -----------------------------------------------------

    async def read_file(self, path: str) -> str:
        """Read file content from the micro-VM via ``cat``."""
        result = await self.exec(f"cat {shlex.quote(path)}")
        if not result.success:
            raise FileNotFoundError(
                f"Cannot read '{path}' in sandbox: {result.stderr}"
            )
        return result.stdout

    async def write_file(self, path: str, content: str) -> None:
        """Write *content* to *path* inside the micro-VM.

        Creates a temporary file on the host, uploads it via ``copy_in``,
        then moves it to the target path. Parent directories are created
        automatically.
        """
        dir_path = os.path.dirname(path) or "/"

        # Ensure parent directory exists
        await self.exec(f"mkdir -p {shlex.quote(dir_path)}")

        # Write to a temp file on the host, then copy into the VM
        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".tmp", delete=False, encoding="utf-8"
        ) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            # copy_in destination must be a directory
            await self._box.copy_in(tmp_path, dir_path)

            # Rename the uploaded temp file to the target name
            tmp_name = os.path.basename(tmp_path)
            target_name = os.path.basename(path)
            if tmp_name != target_name:
                await self.exec(
                    f"mv {shlex.quote(os.path.join(dir_path, tmp_name))} "
                    f"{shlex.quote(path)}"
                )
        finally:
            os.unlink(tmp_path)

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        """Upload a host file into the micro-VM via ``copy_in``."""
        if not os.path.isfile(local_path):
            raise FileNotFoundError(f"Local file not found: {local_path}")

        dir_path = os.path.dirname(remote_path) or "/"
        await self.exec(f"mkdir -p {shlex.quote(dir_path)}")

        await self._box.copy_in(local_path, dir_path)

        # Rename if the base names differ
        uploaded_name = os.path.basename(local_path)
        target_name = os.path.basename(remote_path)
        if uploaded_name != target_name:
            await self.exec(
                f"mv {shlex.quote(os.path.join(dir_path, uploaded_name))} "
                f"{shlex.quote(remote_path)}"
            )

    async def download_file(self, remote_path: str, local_path: str) -> None:
        """Download a file from the micro-VM via ``copy_out``."""
        # Verify the file exists in the sandbox
        check = await self.exec(f"test -f {shlex.quote(remote_path)}")
        if not check.success:
            raise FileNotFoundError(f"Remote file not found: {remote_path}")

        local_dir = os.path.dirname(local_path)
        if local_dir:
            os.makedirs(local_dir, exist_ok=True)

        await self._box.copy_out(remote_path, local_dir or ".")

        # Rename if needed
        downloaded_name = os.path.basename(remote_path)
        target_name = os.path.basename(local_path)
        if downloaded_name != target_name:
            downloaded_path = os.path.join(local_dir or ".", downloaded_name)
            os.rename(downloaded_path, local_path)

    # -- lifecycle -----------------------------------------------------------

    async def close(self) -> None:
        """Shutdown the micro-VM and release all resources."""
        try:
            await self._box.shutdown()
        except Exception as exc:
            logger.warning("Error shutting down Boxlite sandbox: %s", exc)


# ---------------------------------------------------------------------------
# BoxliteProvider
# ---------------------------------------------------------------------------


class BoxliteProvider(SandboxProvider):
    """Boxlite micro-VM sandbox provider.

    Creates hardware-isolated micro-VMs using the Boxlite SDK.
    Each sandbox gets a separate Linux kernel, providing stronger
    isolation than standard Docker containers.
    """

    async def create_session(self, config: SandboxConfig) -> BoxliteSession:
        """Create a micro-VM from *config* and return a ``BoxliteSession``."""
        image = TEMPLATE_IMAGES.get(config.template, DEFAULT_IMAGE)

        box = boxlite.SimpleBox(
            image=image,
            memory_mib=config.memory_mb,
            cpus=config.cpu_count,
        )

        await box.start()

        # Create the canonical home directory
        await box.exec("mkdir", "-p", SANDBOX_HOME_DIR)

        # Set environment variables if provided
        if config.env_vars:
            for name, value in config.env_vars:
                await box.exec(
                    "sh",
                    "-c",
                    f"echo {shlex.quote(f'export {name}={shlex.quote(value)}')} "
                    f">> /etc/profile.d/hiagent_env.sh",
                )

        logger.info(
            "Created Boxlite sandbox (image=%s, memory=%dMiB, cpus=%d)",
            image,
            config.memory_mb,
            config.cpu_count,
        )
        return BoxliteSession(box=box, workdir=SANDBOX_HOME_DIR)

    async def destroy_session(self, session: SandboxSession) -> None:
        """Destroy the sandbox session (idempotent)."""
        await session.close()
