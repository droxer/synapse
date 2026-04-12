"""File operation tools for the sandbox."""

from __future__ import annotations

import os
import shlex
from typing import Any

from agent.sandbox.base import SANDBOX_HOME_DIR
from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)
from agent.tools.sandbox.constants import ARTIFACT_EXTENSIONS


class FileRead(SandboxTool):
    """Read a file from the sandbox filesystem."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_read",
            description="Read the contents of a file inside the sandbox.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file.",
                    },
                },
                "required": ["path"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("file", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path: str = (
            kwargs.get("path")
            or kwargs.get("file_path")
            or kwargs.get("filepath")
            or ""
        )
        if not path.strip():
            return ToolResult.fail(
                f"path must not be empty (received keys: {[k for k in kwargs if k not in ('session', 'event_emitter')]})"
            )

        try:
            content = await session.read_file(path)
        except Exception as exc:
            return ToolResult.fail(f"Failed to read file: {exc}")

        return ToolResult.ok(content, metadata={"path": path})


class FileWrite(SandboxTool):
    """Write content to a file in the sandbox filesystem."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_write",
            description="Write content to a file inside the sandbox.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Content to write to the file.",
                    },
                    "is_artifact": {
                        "type": "boolean",
                        "description": (
                            "Whether this file is a final output artifact "
                            "that should be shown to the user (e.g. a report, "
                            "chart, or export). Defaults to auto-detect based "
                            "on file extension. Set to false for intermediate "
                            "helper scripts or temp files."
                        ),
                    },
                },
                "required": ["path", "content"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("file", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        # Accept common alternative parameter names from LLMs
        path: str = (
            kwargs.get("path")
            or kwargs.get("file_path")
            or kwargs.get("filepath")
            or ""
        )
        content: str = kwargs.get("content") or kwargs.get("text") or ""

        if not path.strip():
            return ToolResult.fail(
                f"path must not be empty (received keys: {[k for k in kwargs if k not in ('session', 'event_emitter')]})"
            )

        try:
            await session.write_file(path, content)
        except Exception as exc:
            return ToolResult.fail(f"Failed to write file: {exc}")

        metadata: dict[str, Any] = {
            "path": path,
            "bytes_written": len(content),
        }

        # Determine whether this file should be treated as an artifact.
        # Explicit is_artifact wins; otherwise use extension heuristic.
        is_artifact = kwargs.get("is_artifact")
        if is_artifact is None:
            _, ext = os.path.splitext(path)
            is_artifact = ext.lower() in ARTIFACT_EXTENSIONS
        if is_artifact:
            metadata["artifact_paths"] = [path]

        return ToolResult.ok(
            f"Successfully wrote {len(content)} bytes to {path}",
            metadata=metadata,
        )


class FileEdit(SandboxTool):
    """Edit a file by replacing a text fragment."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_edit",
            description=(
                "Edit a file inside the sandbox by replacing an exact text "
                "fragment with new text."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute path to the file.",
                    },
                    "old_text": {
                        "type": "string",
                        "description": "The exact text to find and replace.",
                    },
                    "new_text": {
                        "type": "string",
                        "description": "The replacement text.",
                    },
                },
                "required": ["path", "old_text", "new_text"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("file", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path: str = (
            kwargs.get("path")
            or kwargs.get("file_path")
            or kwargs.get("filepath")
            or ""
        )
        old_text: str = kwargs.get("old_text", "")
        new_text: str = kwargs.get("new_text", "")

        if not path.strip():
            return ToolResult.fail(
                f"path must not be empty (received keys: {[k for k in kwargs if k not in ('session', 'event_emitter')]})"
            )
        if not old_text:
            return ToolResult.fail("old_text must not be empty")

        try:
            content = await session.read_file(path)
        except Exception as exc:
            return ToolResult.fail(f"Failed to read file: {exc}")

        if old_text not in content:
            return ToolResult.fail("old_text not found in file")

        updated = content.replace(old_text, new_text, 1)

        try:
            await session.write_file(path, updated)
        except Exception as exc:
            return ToolResult.fail(f"Failed to write file: {exc}")

        return ToolResult.ok(
            f"Successfully edited {path}",
            metadata={"path": path},
        )


class FileList(SandboxTool):
    """List directory contents in the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="file_list",
            description="List files and directories inside the sandbox.",
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to list.",
                        "default": SANDBOX_HOME_DIR,
                    },
                },
                "required": [],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("file", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path: str = kwargs.get("path", SANDBOX_HOME_DIR)

        if not path.strip():
            return ToolResult.fail("Path must not be empty")

        try:
            result = await session.exec(f"ls -la {shlex.quote(path)}")
        except Exception as exc:
            return ToolResult.fail(f"Failed to list directory: {exc}")

        if not result.success:
            return ToolResult.fail(
                f"ls failed (exit {result.exit_code}): {result.stderr}"
            )

        return ToolResult.ok(result.stdout, metadata={"path": path})
