"""Run code snippets inside a sandbox."""

from __future__ import annotations

import os
import shlex
from typing import Any

from agent.sandbox.base import ExtendedSandboxSession
from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)
from agent.tools.sandbox.artifact_detection import (
    build_artifact_paths,
    find_new_output_files,
    snapshot_output_files,
)

_RUNTIME_MAP: dict[str, str] = {
    "python": "python3",
    "javascript": "node",
    "js": "node",
    "node": "node",
    "bash": "bash",
    "sh": "sh",
}

_EXTENSION_MAP: dict[str, str] = {
    "python": ".py",
    "javascript": ".js",
    "js": ".js",
    "node": ".js",
    "bash": ".sh",
    "sh": ".sh",
}


class CodeRun(SandboxTool):
    """Write code to a temp file and execute it inside the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="code_run",
            description=(
                "Write a code snippet to a temporary file and execute it "
                "inside the sandbox with the appropriate runtime."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "The source code to execute.",
                    },
                    "language": {
                        "type": "string",
                        "description": "Programming language (python, javascript, bash).",
                        "default": "python",
                    },
                    "filename": {
                        "type": "string",
                        "description": "Optional filename for the script.",
                    },
                    "output_files": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Absolute paths of final OUTPUT files only (e.g. "
                            "/workspace/report.docx). When set, only these paths "
                            "are registered as artifacts. Do NOT include the "
                            "script file itself. Omit to use auto-detection under "
                            "/workspace."
                        ),
                    },
                },
                "required": ["code"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("code", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        code: str = kwargs.get("code", "")
        language: str = kwargs.get("language", "python").lower()
        filename: str | None = kwargs.get("filename")
        output_files: list[str] = list(kwargs.get("output_files") or [])
        event_emitter: Any | None = kwargs.get("event_emitter")

        if not code.strip():
            return ToolResult.fail("Code must not be empty")

        runtime = _RUNTIME_MAP.get(language)
        if runtime is None:
            supported = ", ".join(sorted(_RUNTIME_MAP.keys()))
            return ToolResult.fail(
                f"Unsupported language '{language}'. Supported: {supported}"
            )

        extension = _EXTENSION_MAP[language]
        target = filename or f"/tmp/_code_run{extension}"

        try:
            await session.write_file(target, code)
        except Exception as exc:
            return ToolResult.fail(f"Failed to write code file: {exc}")

        before_snapshot = await snapshot_output_files(
            session,
        )

        # Place a timestamp marker before execution so we can find new files
        # created during the run, even if they were not listed in output_files.
        ts_marker = f"/tmp/_cr_ts_{os.urandom(4).hex()}"
        await session.exec(f"touch {shlex.quote(ts_marker)}")

        try:
            command = f"{runtime} {shlex.quote(target)}"
            use_streaming = event_emitter is not None and isinstance(
                session, ExtendedSandboxSession
            )

            if use_streaming:
                from agent.tools.sandbox.shell_exec import _make_stream_callbacks

                on_stdout, on_stderr = _make_stream_callbacks(event_emitter)
                result = await session.exec_stream(
                    command,
                    on_stdout=on_stdout,
                    on_stderr=on_stderr,
                    timeout=30,
                )
            else:
                result = await session.exec(command, timeout=30)
        except Exception as exc:
            await session.exec(f"rm -f {shlex.quote(ts_marker)}")
            return ToolResult.fail(f"Code execution failed: {exc}")

        # Scan /workspace and skill directories for output-type files created
        # during execution.  This catches files the LLM forgot to list in
        # output_files.
        auto_found = await find_new_output_files(
            session,
            ts_marker,
            exclude_paths=(target,),
            before_snapshot=before_snapshot,
        )
        await session.exec(f"rm -f {shlex.quote(ts_marker)}")

        combined = result.stdout
        if result.stderr:
            combined = (
                f"{combined}\n[stderr]\n{result.stderr}" if combined else result.stderr
            )

        # Merge explicit output_files with auto-detected ones; exclude the script.
        artifact_paths = build_artifact_paths(
            output_files,
            auto_found,
            exclude_paths=(target,),
        )

        metadata: dict[str, Any] = {"exit_code": result.exit_code, "language": language}
        if artifact_paths:
            metadata["artifact_paths"] = artifact_paths

        return ToolResult.ok(combined, metadata=metadata)
