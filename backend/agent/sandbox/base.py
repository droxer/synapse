"""Sandbox provider abstraction layer for Synapse.

Defines the core types and protocols for creating, managing, and
interacting with sandboxed execution environments.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol, runtime_checkable


SANDBOX_HOME_DIR = "/home/user"
"""Canonical home/working directory inside all sandbox environments."""


@dataclass(frozen=True)
class SandboxConfig:
    """Immutable configuration for a sandbox environment.

    Attributes:
        template: Sandbox template name (e.g. "default", "data_science", "browser").
        timeout: Maximum session lifetime in seconds.
        env_vars: Immutable sequence of (name, value) environment variable pairs.
        memory_mb: Memory limit in megabytes.
        cpu_count: Number of CPU cores available to the sandbox.
    """

    template: str
    timeout: int = 300
    env_vars: tuple[tuple[str, str], ...] = ()
    memory_mb: int = 512
    cpu_count: int = 1


@dataclass(frozen=True)
class CodeOutput:
    """A single rich output from code execution (chart, dataframe, image, etc.)."""

    mime_type: str
    data: str
    display_type: str


@dataclass(frozen=True)
class CodeResult:
    """Result of running code via a code interpreter."""

    stdout: str
    stderr: str
    error: str | None
    results: tuple[CodeOutput, ...]


@dataclass(frozen=True)
class PoolKey:
    """Immutable key for sandbox pool lookups."""

    template: str
    env_vars: tuple[tuple[str, str], ...]


StreamCallback = Callable[[str], None]


@dataclass(frozen=True)
class ExecResult:
    """Immutable result of executing a command inside a sandbox.

    Attributes:
        stdout: Standard output captured from the command.
        stderr: Standard error captured from the command.
        exit_code: Process exit code (0 indicates success).
    """

    stdout: str
    stderr: str
    exit_code: int

    @property
    def success(self) -> bool:
        """Return True when the command exited successfully."""
        return self.exit_code == 0


@runtime_checkable
class SandboxSession(Protocol):
    """Protocol describing a live session inside a sandbox.

    All implementations must be async-compatible.  The protocol is
    marked ``runtime_checkable`` so callers can use ``isinstance``
    guards when needed.
    """

    async def exec(
        self,
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Execute *command* and return the captured result.

        Args:
            command: Shell command to run.
            timeout: Per-command timeout in seconds (``None`` uses the
                session default).
            workdir: Working directory for the command (``None`` keeps the
                sandbox default).

        Returns:
            An ``ExecResult`` with stdout, stderr, and exit_code.
        """
        ...

    async def read_file(self, path: str) -> str:
        """Read and return the text content of *path* inside the sandbox.

        Raises:
            FileNotFoundError: If the file does not exist.
        """
        ...

    async def write_file(self, path: str, content: str) -> None:
        """Write *content* to *path* inside the sandbox.

        Parent directories are created automatically if they do not
        exist.
        """
        ...

    async def upload_file(self, local_path: str, remote_path: str) -> None:
        """Upload a file from the host at *local_path* into the sandbox
        at *remote_path*.

        Raises:
            FileNotFoundError: If *local_path* does not exist on the host.
        """
        ...

    async def download_file(self, remote_path: str, local_path: str) -> None:
        """Download a file from the sandbox at *remote_path* to the host
        at *local_path*.

        Raises:
            FileNotFoundError: If *remote_path* does not exist in the sandbox.
        """
        ...

    async def close(self) -> None:
        """Release all resources held by this session.

        After calling ``close``, no further operations on the session
        are valid.
        """
        ...


@runtime_checkable
class ExtendedSandboxSession(SandboxSession, Protocol):
    """Extended session protocol with code interpreter and streaming support.

    Keeps ``SandboxSession`` unchanged for backward compatibility.
    Providers that support richer features implement this protocol instead.
    """

    async def run_code(self, code: str, language: str = "python") -> CodeResult:
        """Execute code via a code interpreter with rich output support."""
        ...

    async def exec_stream(
        self,
        command: str,
        on_stdout: StreamCallback | None = None,
        on_stderr: StreamCallback | None = None,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        """Execute a command with real-time streaming callbacks."""
        ...

    @property
    def sandbox_id(self) -> str | None:
        """Return the underlying sandbox identifier, if available."""
        ...


class SandboxProvider(ABC):
    """Abstract base for concrete sandbox backends.

    Subclasses must implement session lifecycle management for a
    specific sandbox technology (e.g. Docker, E2B, Firecracker).
    """

    @abstractmethod
    async def create_session(self, config: SandboxConfig) -> SandboxSession:
        """Provision a new sandbox described by *config* and return an
        active session.

        Raises:
            RuntimeError: If the sandbox could not be created.
        """

    @abstractmethod
    async def destroy_session(self, session: SandboxSession) -> None:
        """Tear down *session* and release all associated resources.

        This method is idempotent — calling it on an already-destroyed
        session must not raise.
        """
