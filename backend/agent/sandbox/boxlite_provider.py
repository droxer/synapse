"""Boxlite sandbox provider — micro-VM sandbox backend for HiAgent.

Uses the Boxlite Python SDK to create hardware-isolated micro-VMs
with separate kernels per sandbox instance. Each sandbox gets its own
Linux VM boundary, preventing guest access to the host filesystem.

See: https://docs.boxlite.ai/reference/python/box-types
"""

from __future__ import annotations

import asyncio
import base64
import os
import shlex
import tempfile

import boxlite

from loguru import logger

from agent.sandbox.base import (
    SANDBOX_HOME_DIR,
    CodeResult,
    ExecResult,
    SandboxConfig,
    SandboxProvider,
    SandboxSession,
    StreamCallback,
)

# ---------------------------------------------------------------------------
# Template -> OCI image mapping
# ---------------------------------------------------------------------------

TEMPLATE_IMAGES: dict[str, str] = {
    "default": "ghcr.io/droxer/hiagent-sandbox-default",
    "data_science": "ghcr.io/droxer/hiagent-sandbox-data-science",
    "browser": "ghcr.io/droxer/hiagent-sandbox-browser:v3",
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

    def __init__(
        self,
        box: boxlite.SimpleBox,
        workdir: str = SANDBOX_HOME_DIR,
        env_vars: tuple[tuple[str, str], ...] = (),
    ) -> None:
        self._box = box
        self._workdir = workdir
        self._env_vars = env_vars

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
        env_prefix = ""
        if self._env_vars:
            exports = " ".join(
                f"{name}={shlex.quote(value)}" for name, value in self._env_vars
            )
            env_prefix = f"export {exports} && "

        try:
            # Use sh -c to support full shell syntax
            coro = self._box.exec(
                "sh",
                "-c",
                f"{env_prefix}cd {shlex.quote(effective_workdir)} && {command}",
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
        except boxlite.BoxliteError as exc:
            return ExecResult(
                stdout="",
                stderr=f"Boxlite error: {exc}",
                exit_code=1,
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
            raise FileNotFoundError(f"Cannot read '{path}' in sandbox: {result.stderr}")
        return result.stdout

    async def write_file(self, path: str, content: str) -> None:
        """Write *content* to *path* inside the micro-VM.

        Tries ``copy_in`` first.  If the file does not appear in the VM
        (e.g. ``copy_in`` fails silently), falls back to writing via a
        base64-encoded ``exec`` command.  Parent directories are created
        automatically.
        """
        dir_path = os.path.dirname(path) or "/"

        # Ensure parent directory exists
        await self.exec(f"mkdir -p {shlex.quote(dir_path)}")

        def _write_temp_file() -> str:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".tmp", delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write(content)
                return tmp.name

        # Write to a temp file on the host, then copy into the VM
        tmp_path = await asyncio.to_thread(_write_temp_file)

        try:
            # copy_in destination must be a directory
            await self._box.copy_in(tmp_path, dir_path)

            # Rename the uploaded temp file to the target name
            tmp_name = os.path.basename(tmp_path)
            target_name = os.path.basename(path)
            if tmp_name != target_name:
                mv_result = await self.exec(
                    f"mv {shlex.quote(os.path.join(dir_path, tmp_name))} "
                    f"{shlex.quote(path)}"
                )
                if not mv_result.success:
                    # Don't raise yet — try the base64 fallback below
                    pass
        except Exception:
            logger.warning(
                "Boxlite copy_in failed for %s, will try base64 fallback",
                path,
            )
        finally:
            await asyncio.to_thread(os.unlink, tmp_path)

        # Verify the file actually landed in the VM
        check = await self.exec(f"test -f {shlex.quote(path)}")
        if check.success:
            return

        # Fallback: write via base64-encoded exec (avoids copy_in entirely)
        encoded = base64.b64encode(content.encode("utf-8")).decode("ascii")
        fallback = await self.exec(
            f"echo {shlex.quote(encoded)} | base64 -d > {shlex.quote(path)}"
        )
        if not fallback.success:
            raise OSError(f"Failed to write file to '{path}': {fallback.stderr}")

    async def _file_exists(self, path: str) -> bool:
        """Return True when *path* exists as a regular file in the VM."""
        result = await self.exec(f"test -f {shlex.quote(path)}")
        return result.success

    async def _upload_file_via_base64(self, local_path: str, remote_path: str) -> None:
        """Fallback upload path that does not rely on ``copy_in``."""
        with open(local_path, "rb") as fh:
            encoded = base64.b64encode(fh.read()).decode("ascii")

        encoded_path = f"/tmp/.upload_{os.path.basename(remote_path)}.b64"
        cleanup = await self.exec(f"rm -f {shlex.quote(encoded_path)}")
        if not cleanup.success:
            raise OSError(
                f"Failed to prepare Boxlite fallback upload path: "
                f"{cleanup.stderr or cleanup.stdout}"
            )

        chunk_size = 65536
        for idx in range(0, len(encoded), chunk_size):
            chunk = encoded[idx : idx + chunk_size]
            append = await self.exec(
                f"printf %s {shlex.quote(chunk)} >> {shlex.quote(encoded_path)}"
            )
            if not append.success:
                raise OSError(
                    f"Failed to stage upload chunk for '{remote_path}': "
                    f"{append.stderr or append.stdout}"
                )

        decode = await self.exec(
            f"base64 -d {shlex.quote(encoded_path)} > {shlex.quote(remote_path)} "
            f"&& rm -f {shlex.quote(encoded_path)}"
        )
        if not decode.success:
            raise OSError(
                f"Failed to decode fallback upload for '{remote_path}': "
                f"{decode.stderr or decode.stdout}"
            )

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        """Upload a host file into the micro-VM via ``copy_in``."""
        if not os.path.isfile(local_path):
            raise FileNotFoundError(f"Local file not found: {local_path}")

        dir_path = os.path.dirname(remote_path) or "/"
        uploaded_name = os.path.basename(local_path)
        target_name = os.path.basename(remote_path)
        uploaded_path = os.path.join(dir_path, uploaded_name)

        mkdir_result = await self.exec(f"mkdir -p {shlex.quote(dir_path)}")
        if not mkdir_result.success:
            raise OSError(
                f"Failed to prepare upload directory '{dir_path}': "
                f"{mkdir_result.stderr or mkdir_result.stdout}"
            )

        try:
            await self._upload_file_via_base64(local_path, remote_path)
            if await self._file_exists(remote_path):
                return
        except Exception:
            logger.warning(
                "Boxlite base64 upload failed for {}, falling back to copy_in",
                remote_path,
            )

        copy_succeeded = False
        try:
            await self._box.copy_in(local_path, dir_path)
            copy_succeeded = await self._file_exists(uploaded_path)
        except Exception:
            copy_succeeded = False

        if copy_succeeded:
            if uploaded_name != target_name:
                mv_result = await self.exec(
                    f"mv {shlex.quote(uploaded_path)} {shlex.quote(remote_path)}"
                )
                if mv_result.success and await self._file_exists(remote_path):
                    return
            elif await self._file_exists(remote_path):
                return

        if not await self._file_exists(remote_path):
            raise OSError(f"Uploaded file did not appear at '{remote_path}'")

    async def download_file(self, remote_path: str, local_path: str) -> None:
        """Download a file from the micro-VM.

        Tries ``copy_out`` first.  If the file does not appear on the host
        (e.g. ``copy_out`` fails silently), falls back to reading the file
        via base64-encoded ``exec`` to avoid SDK-level issues.
        """
        # Verify the file exists in the sandbox
        check = await self.exec(f"test -f {shlex.quote(remote_path)}")
        if not check.success:
            raise FileNotFoundError(f"Remote file not found: {remote_path}")

        local_dir = os.path.dirname(local_path)
        if local_dir:
            await asyncio.to_thread(os.makedirs, local_dir, exist_ok=True)

        # Attempt 1: copy_out
        try:
            await self._box.copy_out(remote_path, local_dir or ".")

            downloaded_name = os.path.basename(remote_path)
            target_name = os.path.basename(local_path)
            downloaded_path = os.path.join(local_dir or ".", downloaded_name)

            # Rename to target if needed
            if downloaded_name != target_name:
                if await asyncio.to_thread(os.path.isfile, downloaded_path):
                    await asyncio.to_thread(os.rename, downloaded_path, local_path)

            if await asyncio.to_thread(os.path.isfile, local_path):
                return
        except Exception:
            logger.warning(
                "Boxlite copy_out failed for {}, falling back to base64",
                remote_path,
            )

        # Attempt 2: base64-encoded exec fallback
        await self._download_file_via_base64(remote_path, local_path)

    async def _download_file_via_base64(
        self, remote_path: str, local_path: str
    ) -> None:
        """Fallback download path that reads the file via base64 exec."""
        quoted = shlex.quote(remote_path)
        result = await self.exec(f"base64 {quoted}")
        if not result.success:
            raise OSError(
                f"Failed to read '{remote_path}' via base64: "
                f"{result.stderr or result.stdout}"
            )

        data = base64.b64decode(result.stdout.strip())
        local_dir = os.path.dirname(local_path)
        if local_dir:
            await asyncio.to_thread(os.makedirs, local_dir, exist_ok=True)

        def _write() -> None:
            with open(local_path, "wb") as f:
                f.write(data)

        await asyncio.to_thread(_write)

    # -- code interpreter (ExtendedSandboxSession) ---------------------------

    async def run_code(self, code: str, language: str = "python") -> CodeResult:
        """Execute code via the shell and return a ``CodeResult``.

        This is a lightweight code-interpreter implementation for Boxlite
        that writes the code to a temp file and runs it.  Rich outputs
        (matplotlib images saved to disk) are not automatically captured —
        the calling tool can extract artifacts separately.
        """
        _ext_map = {"python": ".py", "javascript": ".js", "bash": ".sh", "sh": ".sh"}
        _rt_map = {
            "python": "python3",
            "javascript": "node",
            "bash": "bash",
            "sh": "sh",
        }

        ext = _ext_map.get(language, ".py")
        runtime = _rt_map.get(language, "python3")
        target = f"/tmp/_code_interpret{ext}"

        try:
            await self.write_file(target, code)
        except Exception as exc:
            return CodeResult(stdout="", stderr=str(exc), error=str(exc), results=())

        result = await self.exec(f"{runtime} {shlex.quote(target)}", timeout=120)

        error_text: str | None = None
        if not result.success:
            error_text = result.stderr or f"exit code {result.exit_code}"

        return CodeResult(
            stdout=result.stdout,
            stderr=result.stderr,
            error=error_text,
            results=(),
        )

    async def exec_stream(
        self,
        command: str,
        on_stdout: StreamCallback | None = None,
        on_stderr: StreamCallback | None = None,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Execute a command — streaming not supported, falls back to exec."""
        return await self.exec(command, timeout=timeout, workdir=workdir)

    @property
    def sandbox_id(self) -> str | None:
        """Return the Boxlite box identifier."""
        return getattr(self._box, "id", None)

    # -- lifecycle -----------------------------------------------------------

    async def close(self) -> None:
        """Shutdown the micro-VM and release all resources."""
        try:
            await self._box.shutdown()
        except Exception as exc:
            logger.warning("Error shutting down Boxlite sandbox: {}", exc)


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

        # Create the canonical home directory and a /workspace symlink so
        # that sandbox tools (which default to /workspace paths) resolve
        # correctly.
        await box.exec("mkdir", "-p", SANDBOX_HOME_DIR)
        await box.exec("mkdir", "-p", f"{SANDBOX_HOME_DIR}/uploads")
        await box.exec("ln", "-sfn", SANDBOX_HOME_DIR, "/workspace")

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
            "Created Boxlite sandbox (image={}, memory={}MiB, cpus={})",
            image,
            config.memory_mb,
            config.cpu_count,
        )
        return BoxliteSession(
            box=box,
            workdir=SANDBOX_HOME_DIR,
            env_vars=config.env_vars,
        )

    async def destroy_session(self, session: SandboxSession) -> None:
        """Destroy the sandbox session (idempotent)."""
        await session.close()
