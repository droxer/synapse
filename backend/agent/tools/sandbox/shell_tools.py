"""Interactive shell session management tools.

Provides named shell sessions with background process support,
output viewing, stdin writing, and process lifecycle management.
"""

from __future__ import annotations

import re
from typing import Any

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)

_SESSION_DIR = "/tmp/shell_sessions"

# Session IDs must be alphanumeric with hyphens/underscores only.
# Prevents path traversal and shell injection via crafted session names.
_VALID_SESSION_ID = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

# Allowlist for kill signals (defense-in-depth beyond JSON schema enum).
_ALLOWED_SIGNALS = frozenset({"TERM", "KILL", "INT", "HUP"})


def _validate_session_id(session_id: str) -> str | None:
    """Validate and return a sanitized session ID, or None if invalid."""
    stripped = session_id.strip()
    if not _VALID_SESSION_ID.match(stripped):
        return None
    return stripped


def _session_dir(session_id: str) -> str:
    """Return the directory path for a named shell session."""
    return f"{_SESSION_DIR}/{session_id}"


async def _read_pid(session: Any, session_id: str) -> int | None:
    """Read the PID of a named session, return None if not found."""
    sdir = _session_dir(session_id)
    result = await session.exec(f"cat {sdir}/pid 2>/dev/null", timeout=5)
    if result.exit_code != 0 or not result.stdout.strip():
        return None
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


async def _is_running(session: Any, pid: int) -> bool:
    """Check if a process is still running."""
    result = await session.exec(f"kill -0 {pid} 2>/dev/null", timeout=5)
    return result.exit_code == 0


class ShellView(SandboxTool):
    """View output from a named shell session."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_view",
            description=(
                "View the latest output from a named background shell session. "
                "Returns the last N lines of stdout and stderr."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The session name assigned when starting the background command.",
                    },
                    "lines": {
                        "type": "integer",
                        "description": "Number of lines to read from the end of the output.",
                        "default": 50,
                    },
                },
                "required": ["id"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        session_id: str = kwargs.get("id", "")
        lines: int = kwargs.get("lines", 50)

        session_id = _validate_session_id(session_id) if session_id else None
        if session_id is None:
            return ToolResult.fail(
                "Invalid session id. Use 1-64 alphanumeric characters, hyphens, or underscores."
            )

        sdir = _session_dir(session_id)

        # Check session exists
        check = await session.exec(f"test -d {sdir}", timeout=5)
        if check.exit_code != 0:
            return ToolResult.fail(f"Session '{session_id}' not found")

        # Read stdout and stderr tails
        result = await session.exec(
            f"echo '=== stdout ===' && tail -n {lines} {sdir}/stdout.log 2>/dev/null && "
            f"echo '\\n=== stderr ===' && tail -n {lines} {sdir}/stderr.log 2>/dev/null",
            timeout=10,
        )

        # Check if process is still running
        pid = await _read_pid(session, session_id)
        status = "unknown"
        if pid is not None:
            running = await _is_running(session, pid)
            status = "running" if running else "exited"

        output = result.stdout or "(no output)"
        metadata = {"session_id": session_id, "status": status}
        if pid is not None:
            metadata["pid"] = pid

        return ToolResult.ok(
            f"[session '{session_id}' — {status}]\n{output}",
            metadata=metadata,
        )


class ShellWait(SandboxTool):
    """Wait for a named shell session to finish."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_wait",
            description=(
                "Wait for a named background shell session to finish. "
                "Returns the exit code and final output once the process exits, "
                "or times out after the specified duration."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The session name to wait for.",
                    },
                    "timeout": {
                        "type": "integer",
                        "description": "Maximum seconds to wait before timing out.",
                        "default": 30,
                    },
                },
                "required": ["id"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        session_id: str = kwargs.get("id", "")
        timeout: int = kwargs.get("timeout", 30)

        session_id = _validate_session_id(session_id) if session_id else None
        if session_id is None:
            return ToolResult.fail(
                "Invalid session id. Use 1-64 alphanumeric characters, hyphens, or underscores."
            )

        sdir = _session_dir(session_id)
        pid = await _read_pid(session, session_id)
        if pid is None:
            return ToolResult.fail(f"Session '{session_id}' not found or has no PID")

        # Wait for process to exit using a polling loop inside sandbox.
        # We poll kill -0 rather than using `wait` because the background
        # process was spawned in a different shell invocation.
        wait_script = (
            f"ELAPSED=0; "
            f"while kill -0 {pid} 2>/dev/null && [ $ELAPSED -lt {timeout} ]; do "
            f"  sleep 1; ELAPSED=$((ELAPSED+1)); "
            f"done; "
            f"if kill -0 {pid} 2>/dev/null; then "
            f"  echo 'TIMEOUT'; "
            f"else "
            f"  echo 'EXITED'; "
            f"fi"
        )
        result = await session.exec(wait_script, timeout=timeout + 10)

        output_text = result.stdout.strip()
        timed_out = output_text.startswith("TIMEOUT")

        # Read final output
        final = await session.exec(
            f"tail -n 50 {sdir}/stdout.log 2>/dev/null",
            timeout=5,
        )
        stderr = await session.exec(
            f"tail -n 20 {sdir}/stderr.log 2>/dev/null",
            timeout=5,
        )

        combined = final.stdout or ""
        if stderr.stdout:
            combined = (
                f"{combined}\n[stderr]\n{stderr.stdout}" if combined else stderr.stdout
            )

        if timed_out:
            return ToolResult.ok(
                f"[session '{session_id}' — timed out after {timeout}s, still running]\n{combined}",
                metadata={"session_id": session_id, "timed_out": True, "pid": pid},
            )

        # Read exit code from file written by the startup wrapper
        # (see shell_exec.py _start_background_session)
        exit_code = 0
        ec_result = await session.exec(
            f"cat {sdir}/exit_code 2>/dev/null",
            timeout=5,
        )
        if ec_result.exit_code == 0 and ec_result.stdout.strip():
            try:
                exit_code = int(ec_result.stdout.strip())
            except ValueError:
                pass

        return ToolResult.ok(
            f"[session '{session_id}' — exited with code {exit_code}]\n{combined}",
            metadata={"session_id": session_id, "exit_code": exit_code, "pid": pid},
        )


class ShellWrite(SandboxTool):
    """Write stdin input to a running named shell session."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_write",
            description=(
                "Send input (stdin) to a running named shell session. "
                "Useful for interactive processes that expect user input."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The session name to send input to.",
                    },
                    "input": {
                        "type": "string",
                        "description": "The text to write to the process stdin. A newline is appended automatically.",
                    },
                },
                "required": ["id", "input"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        session_id: str = kwargs.get("id", "")
        stdin_input: str = kwargs.get("input", "")

        session_id = _validate_session_id(session_id) if session_id else None
        if session_id is None:
            return ToolResult.fail(
                "Invalid session id. Use 1-64 alphanumeric characters, hyphens, or underscores."
            )

        sdir = _session_dir(session_id)
        pid = await _read_pid(session, session_id)
        if pid is None:
            return ToolResult.fail(f"Session '{session_id}' not found")

        running = await _is_running(session, pid)
        if not running:
            return ToolResult.fail(
                f"Session '{session_id}' (PID {pid}) is no longer running"
            )

        # Write to the named pipe
        # Escape single quotes in input for safe shell embedding
        escaped = stdin_input.replace("'", "'\\''")
        result = await session.exec(
            f"echo '{escaped}' > {sdir}/stdin_pipe",
            timeout=10,
        )

        if result.exit_code != 0:
            return ToolResult.fail(
                f"Failed to write to session '{session_id}': {result.stderr}"
            )

        return ToolResult.ok(
            f"Sent input to session '{session_id}' (PID {pid})",
            metadata={"session_id": session_id, "pid": pid},
        )


class ShellKill(SandboxTool):
    """Terminate a named shell session."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="shell_kill",
            description=(
                "Send a signal to a named shell session to stop it. "
                "Defaults to SIGTERM for graceful shutdown. "
                "Use signal 'KILL' for forceful termination."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "The session name to terminate.",
                    },
                    "signal": {
                        "type": "string",
                        "description": "Signal to send (TERM, KILL, INT, HUP).",
                        "default": "TERM",
                        "enum": ["TERM", "KILL", "INT", "HUP"],
                    },
                },
                "required": ["id"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("shell", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        session_id: str = kwargs.get("id", "")
        signal: str = kwargs.get("signal", "TERM")

        session_id = _validate_session_id(session_id) if session_id else None
        if session_id is None:
            return ToolResult.fail(
                "Invalid session id. Use 1-64 alphanumeric characters, hyphens, or underscores."
            )

        # Validate signal against allowlist (defense-in-depth beyond JSON schema)
        if signal not in _ALLOWED_SIGNALS:
            return ToolResult.fail(
                f"Invalid signal '{signal}'. Allowed: {', '.join(sorted(_ALLOWED_SIGNALS))}"
            )

        pid = await _read_pid(session, session_id)
        if pid is None:
            return ToolResult.fail(f"Session '{session_id}' not found")

        running = await _is_running(session, pid)
        if not running:
            return ToolResult.ok(
                f"Session '{session_id}' (PID {pid}) already exited",
                metadata={"session_id": session_id, "pid": pid, "already_exited": True},
            )

        # Send signal
        result = await session.exec(
            f"kill -{signal} {pid} 2>&1",
            timeout=10,
        )

        if result.exit_code != 0:
            return ToolResult.fail(
                f"Failed to send {signal} to session '{session_id}': {result.stderr or result.stdout}"
            )

        return ToolResult.ok(
            f"Sent SIG{signal} to session '{session_id}' (PID {pid})",
            metadata={"session_id": session_id, "pid": pid, "signal": signal},
        )
