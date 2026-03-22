"""Granular browser tools providing step-by-step LLM-controlled browsing.

Each tool performs a single browser action and returns the current DOM state
with indexed interactive elements.  This gives the LLM fine-grained control
over browser navigation, complementing the high-level ``browser_use`` tool
which delegates multi-step tasks to an autonomous agent.
"""

from __future__ import annotations

from typing import Any

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)
from agent.tools.sandbox.browser_session import (
    format_dom_state,
    send_browser_command,
)

_TAGS = ("browser", "browser_granular")


def _build_result(response: dict[str, Any]) -> ToolResult:
    """Convert a browser driver response to a ToolResult."""
    if not response.get("success"):
        return ToolResult.fail(response.get("error", "Browser command failed"))

    state = response.get("state", {})
    output = format_dom_state(state)

    metadata: dict[str, Any] = {
        "url": state.get("url"),
        "title": state.get("title"),
        "element_count": len(state.get("elements", [])),
    }

    screenshot_path = state.get("screenshot_path")
    if screenshot_path:
        metadata["artifact_paths"] = [screenshot_path]

    return ToolResult.ok(output, metadata=metadata)


class BrowserNavigate(SandboxTool):
    """Navigate to a URL and return the page DOM state."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_navigate",
            description=(
                "Navigate the browser to a URL. Returns the page DOM state "
                "with indexed interactive elements that can be referenced by "
                "index in subsequent browser actions."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to navigate to.",
                    },
                },
                "required": ["url"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        url: str = kwargs.get("url", "")
        if not url.strip():
            return ToolResult.fail("URL must not be empty")

        response = await send_browser_command(
            session,
            {"action": "navigate", "url": url},
            timeout=35,
        )
        return _build_result(response)


class BrowserView(SandboxTool):
    """View the current page DOM state without performing any action."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_view",
            description=(
                "View the current browser page state. Returns the URL, title, "
                "and indexed interactive elements. Use this to re-read the page "
                "after waiting or to inspect the current state."
            ),
            input_schema={
                "type": "object",
                "properties": {},
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {"action": "view"},
            timeout=15,
        )
        return _build_result(response)


class BrowserClick(SandboxTool):
    """Click an element by index or coordinates."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_click",
            description=(
                "Click on an interactive element. Specify the element by its "
                "index from the DOM state, or by x/y pixel coordinates as a "
                "fallback. Returns the updated page state after clicking."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Index of the element to click (from the DOM state).",
                    },
                    "x": {
                        "type": "integer",
                        "description": "X pixel coordinate to click (fallback when index is unavailable).",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y pixel coordinate to click (fallback when index is unavailable).",
                    },
                },
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        cmd: dict[str, Any] = {"action": "click"}
        if "index" in kwargs:
            cmd["index"] = kwargs["index"]
        elif "x" in kwargs and "y" in kwargs:
            cmd["x"] = kwargs["x"]
            cmd["y"] = kwargs["y"]
        else:
            return ToolResult.fail("Provide either 'index' or both 'x' and 'y'")

        response = await send_browser_command(session, cmd, timeout=20)
        return _build_result(response)


class BrowserInput(SandboxTool):
    """Type text into an input element."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_input",
            description=(
                "Type text into an input element identified by its index. "
                "By default, clears the field first. Set clear=false to append."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Index of the input element (from the DOM state).",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type into the element.",
                    },
                    "clear": {
                        "type": "boolean",
                        "description": "Clear the field before typing.",
                        "default": True,
                    },
                },
                "required": ["index", "text"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        index: int = kwargs.get("index", 0)
        text: str = kwargs.get("text", "")
        clear: bool = kwargs.get("clear", True)

        response = await send_browser_command(
            session,
            {"action": "input", "index": index, "text": text, "clear": clear},
            timeout=15,
        )
        return _build_result(response)


class BrowserSelect(SandboxTool):
    """Select an option from a dropdown element."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_select",
            description=(
                "Select an option from a dropdown (<select>) element by its "
                "index. Specify the value to select."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Index of the select element (from the DOM state).",
                    },
                    "value": {
                        "type": "string",
                        "description": "Value of the option to select.",
                    },
                },
                "required": ["index", "value"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {
                "action": "select",
                "index": kwargs.get("index", 0),
                "value": kwargs.get("value", ""),
            },
            timeout=15,
        )
        return _build_result(response)


class BrowserScrollUp(SandboxTool):
    """Scroll the page up."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_scroll_up",
            description="Scroll the browser page up by the specified number of pixels.",
            input_schema={
                "type": "object",
                "properties": {
                    "pixels": {
                        "type": "integer",
                        "description": "Number of pixels to scroll up.",
                        "default": 500,
                    },
                },
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {"action": "scroll_up", "pixels": kwargs.get("pixels", 500)},
            timeout=10,
        )
        return _build_result(response)


class BrowserScrollDown(SandboxTool):
    """Scroll the page down."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_scroll_down",
            description="Scroll the browser page down by the specified number of pixels.",
            input_schema={
                "type": "object",
                "properties": {
                    "pixels": {
                        "type": "integer",
                        "description": "Number of pixels to scroll down.",
                        "default": 500,
                    },
                },
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {"action": "scroll_down", "pixels": kwargs.get("pixels", 500)},
            timeout=10,
        )
        return _build_result(response)


class BrowserPressKey(SandboxTool):
    """Press a keyboard key."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_press_key",
            description=(
                "Press a keyboard key in the browser. Supports standard key "
                "names: Enter, Escape, Tab, Backspace, ArrowUp, ArrowDown, "
                "ArrowLeft, ArrowRight, etc."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Key to press (e.g. 'Enter', 'Escape', 'Tab').",
                    },
                },
                "required": ["key"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        key: str = kwargs.get("key", "")
        if not key.strip():
            return ToolResult.fail("Key must not be empty")

        response = await send_browser_command(
            session,
            {"action": "press_key", "key": key},
            timeout=10,
        )
        return _build_result(response)


class BrowserConsoleExec(SandboxTool):
    """Execute JavaScript in the browser console."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_console_exec",
            description=(
                "Execute JavaScript code in the browser page context. "
                "Returns the evaluation result and the current page state."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "script": {
                        "type": "string",
                        "description": "JavaScript code to execute in the page.",
                    },
                },
                "required": ["script"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        script: str = kwargs.get("script", "")
        if not script.strip():
            return ToolResult.fail("Script must not be empty")

        response = await send_browser_command(
            session,
            {"action": "console_exec", "script": script},
            timeout=15,
        )

        if not response.get("success"):
            return ToolResult.fail(response.get("error", "Script execution failed"))

        js_result = response.get("result", "")
        state = response.get("state", {})
        output = (
            f"Result: {js_result}\n\n{format_dom_state(state)}"
            if js_result
            else format_dom_state(state)
        )

        metadata: dict[str, Any] = {
            "url": state.get("url"),
            "title": state.get("title"),
            "element_count": len(state.get("elements", [])),
        }
        return ToolResult.ok(output, metadata=metadata)


class BrowserConsoleView(SandboxTool):
    """View recent browser console logs."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_console_view",
            description=(
                "View recent console output from the browser page. "
                "Shows the last 50 console messages (log, warn, error)."
            ),
            input_schema={
                "type": "object",
                "properties": {},
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=_TAGS,
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        response = await send_browser_command(
            session,
            {"action": "console_view"},
            timeout=10,
        )

        if not response.get("success"):
            return ToolResult.fail(response.get("error", "Failed to view console"))

        logs = response.get("logs", [])
        state = response.get("state", {})

        log_text = "\n".join(logs) if logs else "(no console output)"
        output = f"Console Logs:\n{log_text}\n\n{format_dom_state(state)}"

        metadata: dict[str, Any] = {
            "url": state.get("url"),
            "element_count": len(state.get("elements", [])),
        }
        return ToolResult.ok(output, metadata=metadata)
