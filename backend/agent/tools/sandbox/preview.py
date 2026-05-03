"""Real-time preview tools for serving web content from the sandbox."""

from __future__ import annotations

import shlex
from typing import Any

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)


class PreviewStart(SandboxTool):
    """Start a preview server for web content in the sandbox."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="preview_start",
            description=(
                "Start a web server in the sandbox to preview content. "
                "Launches a simple HTTP server on the specified port and directory. "
                "Returns a preview URL that can be displayed in the frontend."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "port": {
                        "type": "integer",
                        "description": "Port to serve on inside the sandbox.",
                        "default": 8080,
                    },
                    "directory": {
                        "type": "string",
                        "description": "Directory to serve. Defaults to /workspace.",
                        "default": "/workspace",
                    },
                    "command": {
                        "type": "string",
                        "description": (
                            "Optional custom command to start the server "
                            "(e.g., 'npm start', 'python app.py'). "
                            "If not provided, uses python http.server."
                        ),
                    },
                },
                "required": [],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("preview", "web", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        port: int = kwargs.get("port", 8080)
        directory: str = kwargs.get("directory", "/workspace")
        command: str = kwargs.get("command", "")
        event_emitter: Any | None = kwargs.get("event_emitter")
        conversation_id: str | None = kwargs.get("conversation_id")

        if port < 1024 or port > 65535:
            return ToolResult.fail("Port must be between 1024 and 65535")

        # Kill any existing server on this port
        await session.exec(f"fuser -k {port}/tcp 2>/dev/null || true", timeout=5)

        # Start server
        safe_dir = shlex.quote(directory)
        if command:
            safe_cmd = shlex.quote(command)
            server_cmd = f"cd {safe_dir} && sh -c {safe_cmd}"
        else:
            server_cmd = (
                f"cd {safe_dir} && python3 -m http.server {port} --bind 0.0.0.0"
            )

        # Run in background
        await session.exec(
            f"nohup sh -c {shlex.quote(server_cmd)} > /tmp/preview_server.log 2>&1 &disown",
            timeout=5,
        )

        # Wait for server to start
        await session.exec("sleep 1", timeout=5)

        # Verify server is running
        check = await session.exec(f"fuser {port}/tcp 2>/dev/null", timeout=5)
        if check.exit_code != 0:
            # Read log for error details
            log = await session.exec(
                "cat /tmp/preview_server.log 2>/dev/null", timeout=5
            )
            return ToolResult.fail(
                f"Server failed to start on port {port}. "
                f"Log: {log.stdout or log.stderr}"
            )

        # Build the proxy URL so the agent can share it with the user
        preview_url: str | None = None
        if conversation_id:
            preview_url = f"/api/conversations/{conversation_id}/preview/"
            if port != 8080:
                preview_url = f"{preview_url}?_port={port}"

        # Emit preview available event
        if event_emitter is not None:
            from api.events import EventType

            await event_emitter.emit(
                EventType.PREVIEW_AVAILABLE,
                {"port": port, "directory": directory, "url": preview_url},
            )

        url_note = (
            f" Access it at: {preview_url}"
            if preview_url
            else " Access it via the sandbox proxy."
        )
        return ToolResult.ok(
            f"Preview server started on port {port} serving {directory}.{url_note}",
            metadata={
                "port": port,
                "directory": directory,
                "preview_active": True,
                "preview_url": preview_url,
            },
        )


class PreviewStop(SandboxTool):
    """Stop a running preview server."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="preview_stop",
            description="Stop a running preview server on the specified port.",
            input_schema={
                "type": "object",
                "properties": {
                    "port": {
                        "type": "integer",
                        "description": "Port of the server to stop.",
                        "default": 8080,
                    },
                },
                "required": [],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("preview", "web", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        port: int = kwargs.get("port", 8080)
        event_emitter: Any | None = kwargs.get("event_emitter")

        await session.exec(f"fuser -k {port}/tcp 2>/dev/null", timeout=5)

        if event_emitter is not None:
            from api.events import EventType

            await event_emitter.emit(
                EventType.PREVIEW_STOPPED,
                {"port": port},
            )

        return ToolResult.ok(
            f"Preview server on port {port} stopped.",
            metadata={"port": port, "preview_active": False},
        )
