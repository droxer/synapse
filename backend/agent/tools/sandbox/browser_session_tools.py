"""Persistent browser session helper tools."""

from __future__ import annotations

from typing import Any

from agent.tools.base import ExecutionContext, SandboxTool, ToolDefinition, ToolResult
from agent.tools.sandbox.browser_session import format_dom_state, send_browser_command

_TAGS = ("browser", "browser_session")


class BrowserSessionSave(SandboxTool):
    """Save the current browser storage state to disk."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_session_save",
            title="Browser Session Save",
            description=(
                "Save the current browser cookies and storage state to a JSON file "
                "inside the sandbox so it can be reused later."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Destination path for the saved browser session JSON.",
                        "default": "/workspace/browser-session.json",
                    }
                },
            },
            execution_context=ExecutionContext.SANDBOX,
            annotations={"readOnlyHint": False},
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "/workspace/browser-session.json")).strip()
        response = await send_browser_command(
            session,
            {"action": "save_session", "path": path},
            timeout=20,
        )
        if not response.get("success"):
            return ToolResult.fail(
                response.get("error", "Failed to save browser session")
            )
        return ToolResult.ok(
            f"Saved browser session to {path}",
            metadata={"path": path, "artifact_paths": [path]},
        )


class BrowserSessionLoad(SandboxTool):
    """Load a saved browser storage state from disk."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_session_load",
            title="Browser Session Load",
            description=(
                "Load a previously saved browser session JSON file and recreate "
                "the persistent browser context with those cookies and storage values."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the saved browser session JSON.",
                    },
                    "url": {
                        "type": "string",
                        "description": "Optional URL to open immediately after restoring the session.",
                    },
                },
                "required": ["path"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        path = str(kwargs.get("path", "")).strip()
        url = str(kwargs.get("url", "")).strip()
        if not path:
            return ToolResult.fail("path must not be empty")
        payload = {"action": "load_session", "path": path}
        if url:
            payload["url"] = url
        response = await send_browser_command(session, payload, timeout=35)
        if not response.get("success"):
            return ToolResult.fail(
                response.get("error", "Failed to load browser session")
            )

        state = response.get("state", {})
        metadata: dict[str, Any] = {
            "path": path,
            "url": state.get("url"),
            "title": state.get("title"),
        }
        screenshot_path = state.get("screenshot_path")
        if screenshot_path:
            metadata["artifact_paths"] = [screenshot_path]
        return ToolResult.ok(format_dom_state(state), metadata=metadata)


class BrowserDownloads(SandboxTool):
    """List files downloaded by the persistent browser session."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_downloads",
            title="Browser Downloads",
            description=(
                "List files downloaded by the persistent browser session and "
                "return them as extractable artifacts when available."
            ),
            input_schema={"type": "object", "properties": {}},
            execution_context=ExecutionContext.SANDBOX,
            annotations={"readOnlyHint": True},
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {"action": "list_downloads"},
            timeout=15,
        )
        if not response.get("success"):
            return ToolResult.fail(
                response.get("error", "Failed to list browser downloads")
            )

        downloads = response.get("downloads", [])
        lines = ["Downloads:"]
        artifact_paths: list[str] = []
        for item in downloads:
            name = str(item.get("name", "download"))
            path = str(item.get("path", ""))
            size = int(item.get("size", 0))
            lines.append(f"- {name} ({size} bytes)")
            if path:
                artifact_paths.append(path)
        if len(lines) == 1:
            lines.append("(no downloads)")

        metadata: dict[str, Any] = {"download_count": len(downloads)}
        if artifact_paths:
            metadata["artifact_paths"] = artifact_paths
        return ToolResult.ok("\n".join(lines), metadata=metadata)


class BrowserUpload(SandboxTool):
    """Upload a sandbox file into a file input element."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_upload",
            title="Browser Upload",
            description=(
                "Set one or more sandbox files on a browser file input element "
                "identified by its indexed DOM position."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Index of the target file input element.",
                    },
                    "path": {
                        "type": "string",
                        "description": "Single sandbox file path to upload.",
                    },
                    "paths": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Multiple sandbox file paths to upload.",
                    },
                },
                "required": ["index"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        index = kwargs.get("index")
        if not isinstance(index, int):
            return ToolResult.fail("index must be an integer")

        paths = kwargs.get("paths")
        if isinstance(paths, list):
            normalized_paths = [
                str(path).strip() for path in paths if str(path).strip()
            ]
        else:
            single_path = str(kwargs.get("path", "")).strip()
            normalized_paths = [single_path] if single_path else []
        if not normalized_paths:
            return ToolResult.fail("path or paths must not be empty")

        response = await send_browser_command(
            session,
            {"action": "upload", "index": index, "paths": normalized_paths},
            timeout=20,
        )
        if not response.get("success"):
            return ToolResult.fail(
                response.get("error", "Failed to upload file in browser")
            )

        state = response.get("state", {})
        metadata = {
            "uploaded_paths": normalized_paths,
            "url": state.get("url"),
            "title": state.get("title"),
        }
        screenshot_path = state.get("screenshot_path")
        if screenshot_path:
            metadata["artifact_paths"] = [screenshot_path]
        return ToolResult.ok(format_dom_state(state), metadata=metadata)
