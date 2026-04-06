"""E2B cloud sandbox provider for Synapse.

Uses the E2B SDK to create cloud-hosted sandbox environments.
The E2B SDK is synchronous, so all calls are wrapped in
``asyncio.to_thread`` to keep the event loop responsive.
The e2b dependency is imported lazily so the rest of the framework
works without it.
"""

from __future__ import annotations

import asyncio
import traceback
from typing import Any

from loguru import logger

from agent.sandbox.base import (
    SANDBOX_HOME_DIR,
    CodeOutput,
    CodeResult,
    ExecResult,
    PoolKey,
    SandboxConfig,
    SandboxProvider,
    SandboxSession,
    StreamCallback,
)

# ---------------------------------------------------------------------------
# Template -> E2B template ID mapping
# ---------------------------------------------------------------------------

TEMPLATE_IDS: dict[str, str] = {
    "default": "synapse-default",
    "data_science": "synapse-data-science",
    "browser": "synapse-browser",
}


def _import_e2b() -> Any:
    """Lazily import the e2b SDK, raising a clear error if missing."""
    try:
        from e2b_code_interpreter import Sandbox  # noqa: WPS433
    except ImportError as exc:
        raise ImportError(
            "The 'e2b-code-interpreter' package is required for E2BProvider. "
            "Install it with: pip install e2b-code-interpreter"
        ) from exc
    return Sandbox


def _infer_display_type(mime_type: str) -> str:
    """Map a MIME type to a display hint."""
    if mime_type.startswith("image/"):
        return "image"
    if mime_type in ("text/html", "application/json"):
        return "dataframe"
    if mime_type == "application/vnd.plotly.v1+json":
        return "chart"
    return "text"


# ---------------------------------------------------------------------------
# E2BSession
# ---------------------------------------------------------------------------


class E2BSession:
    """A live sandbox session backed by an E2B cloud sandbox.

    Implements the ``SandboxSession`` protocol. Wraps the E2B
    ``Sandbox`` instance to provide a consistent interface with
    the rest of Synapse. All synchronous E2B SDK calls are dispatched
    via ``asyncio.to_thread``.
    """

    def __init__(self, sandbox: Any, config: SandboxConfig | None = None) -> None:
        self._sandbox = sandbox
        self._config = config

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Run *command* inside the E2B sandbox."""
        try:
            kwargs: dict[str, Any] = {"cwd": workdir or SANDBOX_HOME_DIR}
            if timeout is not None:
                kwargs["timeout"] = timeout

            result = await asyncio.to_thread(
                self._sandbox.commands.run, command, **kwargs
            )
            return ExecResult(
                stdout=result.stdout or "",
                stderr=result.stderr or "",
                exit_code=result.exit_code,
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            logger.error(
                "E2B exec failed for command '%s': %s\n%s",
                command,
                exc,
                traceback.format_exc(),
            )
            return ExecResult(stdout="", stderr=str(exc), exit_code=1)

    async def read_file(self, path: str) -> str:
        """Read file content from the E2B sandbox."""
        try:
            content = await asyncio.to_thread(self._sandbox.files.read, path)
            if isinstance(content, bytes):
                return content.decode("utf-8", errors="replace")
            return content
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise FileNotFoundError(
                f"Cannot read '{path}' in E2B sandbox: {exc}"
            ) from exc

    async def write_file(self, path: str, content: str) -> None:
        """Write *content* to *path* in the E2B sandbox."""
        try:
            write_data = (
                content
                if isinstance(content, str)
                else content.decode("utf-8", errors="replace")
            )
            await asyncio.to_thread(self._sandbox.files.write, path, write_data)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise RuntimeError(f"Cannot write '{path}' in E2B sandbox: {exc}") from exc

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        """Upload a host file into the E2B sandbox."""
        import os

        if not os.path.isfile(local_path):
            raise FileNotFoundError(f"Local file not found: {local_path}")

        try:
            with open(local_path, "rb") as fh:
                file_bytes = fh.read()
            # E2B files.write accepts both str and bytes; pass raw bytes
            # to preserve binary content (images, Excel, Parquet, etc.)
            await asyncio.to_thread(self._sandbox.files.write, remote_path, file_bytes)
        except FileNotFoundError:
            raise
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise RuntimeError(f"Upload to '{remote_path}' failed: {exc}") from exc

    async def download_file(self, remote_path: str, local_path: str) -> None:
        """Download a file from the E2B sandbox to the host."""
        import os

        try:
            content = await asyncio.to_thread(self._sandbox.files.read, remote_path)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise FileNotFoundError(f"Remote file not found: {remote_path}") from exc

        local_dir = os.path.dirname(local_path)
        if local_dir:
            os.makedirs(local_dir, exist_ok=True)

        # Normalize to bytes for consistent binary-safe writing
        if isinstance(content, str):
            write_bytes = content.encode("utf-8")
        else:
            write_bytes = content

        with open(local_path, "wb") as fh:
            fh.write(write_bytes)

    @property
    def sandbox_id(self) -> str | None:
        """Return the E2B sandbox identifier."""
        return getattr(self._sandbox, "sandbox_id", None)

    def _pool_key(self) -> PoolKey | None:
        """Derive a pool key from the stored config, if available."""
        if self._config is None:
            return None
        return PoolKey(
            template=self._config.template,
            env_vars=self._config.env_vars,
        )

    async def run_code(self, code: str, language: str = "python") -> CodeResult:
        """Execute code via the E2B code interpreter."""
        try:
            execution = await asyncio.to_thread(
                self._sandbox.run_code, code, language=language
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            return CodeResult(
                stdout="",
                stderr=str(exc),
                error=str(exc),
                results=(),
            )

        outputs: list[CodeOutput] = []
        for result_item in getattr(execution, "results", []):
            for mime_type, data in getattr(result_item, "raw", {}).items():
                outputs.append(
                    CodeOutput(
                        mime_type=mime_type,
                        data=data,
                        display_type=_infer_display_type(mime_type),
                    )
                )

        error_text = None
        if hasattr(execution, "error") and execution.error:
            error_text = str(execution.error)

        return CodeResult(
            stdout=getattr(execution, "stdout", "") or "",
            stderr=getattr(execution, "stderr", "") or "",
            error=error_text,
            results=tuple(outputs),
        )

    async def exec_stream(
        self,
        command: str,
        on_stdout: StreamCallback | None = None,
        on_stderr: StreamCallback | None = None,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Execute a command with real-time streaming callbacks."""
        try:
            kwargs: dict[str, Any] = {"cwd": workdir or SANDBOX_HOME_DIR}
            if timeout is not None:
                kwargs["timeout"] = timeout
            if on_stdout is not None:
                kwargs["on_stdout"] = lambda data: on_stdout(
                    data.line if hasattr(data, "line") else str(data)
                )
            if on_stderr is not None:
                kwargs["on_stderr"] = lambda data: on_stderr(
                    data.line if hasattr(data, "line") else str(data)
                )

            result = await asyncio.to_thread(
                self._sandbox.commands.run, command, **kwargs
            )
            return ExecResult(
                stdout=result.stdout or "",
                stderr=result.stderr or "",
                exit_code=result.exit_code,
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            logger.error(
                "E2B exec_stream failed for command '{}': {}\n{}",
                command,
                exc,
                traceback.format_exc(),
            )
            return ExecResult(stdout="", stderr=str(exc), exit_code=1)

    async def close(self) -> None:
        """Pause the E2B sandbox (preserves state for pooling)."""
        try:
            await asyncio.to_thread(self._sandbox.pause)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            logger.warning("Error pausing E2B sandbox, falling back to kill: {}", exc)
            await self.kill()

    async def kill(self) -> None:
        """Permanently destroy the E2B sandbox."""
        try:
            await asyncio.to_thread(self._sandbox.kill)
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            logger.warning("Error killing E2B sandbox: {}", exc)


# ---------------------------------------------------------------------------
# E2BProvider
# ---------------------------------------------------------------------------


class E2BProvider(SandboxProvider):
    """Cloud sandbox provider using the E2B platform.

    Creates cloud-hosted sandbox environments via the E2B SDK.
    Requires a valid E2B API key. Optionally uses a ``SandboxPool``
    to reuse paused sandboxes across conversations.
    """

    def __init__(
        self,
        api_key: str,
        pool: Any | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("api_key must not be empty")
        self._api_key = api_key
        self._pool = pool

    def _resolve_template(self, template: str) -> str:
        """Map a template name to an E2B template ID."""
        template_id = TEMPLATE_IDS.get(template)
        if template_id is None:
            raise ValueError(
                f"Unknown template '{template}'. "
                f"Available: {', '.join(sorted(TEMPLATE_IDS))}"
            )
        return template_id

    async def create_session(self, config: SandboxConfig) -> E2BSession:
        """Create an E2B sandbox from *config* and return an ``E2BSession``.

        If a pool is configured, attempts to reuse a paused sandbox first.
        """
        if self._pool is not None:
            pooled = await self._pool.acquire(config)
            if pooled is not None:
                return pooled

        SandboxClass = _import_e2b()
        template_id = self._resolve_template(config.template)
        env_dict = {k: v for k, v in config.env_vars}

        try:
            sandbox = await asyncio.to_thread(
                SandboxClass,
                template=template_id,
                api_key=self._api_key,
                timeout=config.timeout,
                envs=env_dict if env_dict else None,
            )
        except (KeyboardInterrupt, SystemExit):
            raise
        except Exception as exc:
            raise RuntimeError(
                f"Failed to create E2B sandbox (template={template_id}): {exc}"
            ) from exc

        # Ensure the canonical home directory exists and create a /workspace
        # symlink so that sandbox tools (which default to /workspace paths)
        # resolve correctly.
        await asyncio.to_thread(
            sandbox.commands.run,
            " && ".join(
                (
                    f"mkdir -p {SANDBOX_HOME_DIR}",
                    f"mkdir -p {SANDBOX_HOME_DIR}/uploads",
                    f"ln -sfn {SANDBOX_HOME_DIR} /workspace",
                )
            ),
        )

        logger.info("Created E2B sandbox (template={})", template_id)
        return E2BSession(sandbox=sandbox, config=config)

    async def destroy_session(self, session: SandboxSession) -> None:
        """Return the session to the pool if available, otherwise close it."""
        if self._pool is not None and isinstance(session, E2BSession):
            logger.info("Releasing E2B sandbox to pool")
            await self._pool.release(session)
        elif isinstance(session, E2BSession):
            logger.info("Killing non-pooled E2B sandbox")
            await session.kill()
        else:
            await session.close()
