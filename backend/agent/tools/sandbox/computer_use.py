"""Computer Use tool for controlling a virtual desktop in the sandbox."""

from __future__ import annotations

import re
import shlex
from typing import Any

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)

_SCREENSHOT_PATH = "/tmp/desktop_screenshot.png"
_SCREEN_WIDTH = 1280
_SCREEN_HEIGHT = 720

# Allowed pattern for xdotool key names (e.g. "Return", "ctrl+c", "shift+Tab")
_KEY_NAME_RE = re.compile(r"^[a-zA-Z0-9_+]+$")


async def _ensure_desktop(session: Any) -> bool:
    """Ensure a virtual desktop is running in the sandbox."""
    check = await session.exec("pgrep -x Xvfb", timeout=5)
    if check.exit_code == 0:
        return True

    # Start Xvfb
    result = await session.exec(
        "Xvfb :99 -screen 0 1280x720x24 &disown && sleep 1 && export DISPLAY=:99",
        timeout=10,
    )
    return result.exit_code == 0


async def _take_screenshot(session: Any) -> str | None:
    """Take a screenshot and return base64-encoded PNG."""
    result = await session.exec(
        f"DISPLAY=:99 import -window root {_SCREENSHOT_PATH} 2>/dev/null "
        f"|| DISPLAY=:99 xwd -root -silent | convert xwd:- png:{_SCREENSHOT_PATH}",
        timeout=10,
    )
    if result.exit_code != 0:
        return None

    b64_result = await session.exec(f"base64 -w0 {_SCREENSHOT_PATH}", timeout=10)
    if b64_result.exit_code == 0 and b64_result.stdout:
        return b64_result.stdout.strip()
    return None


class ComputerScreenshot(SandboxTool):
    """Take a screenshot of the virtual desktop."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="computer_screenshot",
            description=(
                "Take a screenshot of the virtual desktop in the sandbox. "
                "Returns the screenshot as an image for visual inspection."
            ),
            input_schema={
                "type": "object",
                "properties": {},
                "required": [],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("computer_use", "desktop", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        await _ensure_desktop(session)

        screenshot_b64 = await _take_screenshot(session)
        if screenshot_b64 is None:
            return ToolResult.fail(
                "Failed to capture screenshot. "
                "Ensure xvfb and imagemagick are installed in the sandbox."
            )

        return ToolResult.ok(
            "Desktop screenshot captured.",
            metadata={
                "screenshot": _SCREENSHOT_PATH,
                "screenshot_base64": screenshot_b64,
            },
        )


class ComputerAction(SandboxTool):
    """Perform mouse and keyboard actions on the virtual desktop."""

    _VALID_ACTIONS = frozenset({
        "click", "double_click", "right_click",
        "move", "drag",
        "type", "key",
        "scroll_up", "scroll_down",
    })

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="computer_action",
            description=(
                "Perform a mouse or keyboard action on the virtual desktop. "
                "Actions include click, type, key press, scroll, and drag. "
                "A screenshot is automatically taken after each action. "
                "Scroll actions apply at the current mouse position; "
                "use 'move' first to scroll at a specific location."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": (
                            "Action to perform: 'click', 'double_click', 'right_click', "
                            "'move', 'drag', 'type', 'key', 'scroll_up', 'scroll_down'."
                        ),
                        "enum": [
                            "click", "double_click", "right_click",
                            "move", "drag",
                            "type", "key",
                            "scroll_up", "scroll_down",
                        ],
                    },
                    "x": {
                        "type": "integer",
                        "description": "X coordinate for mouse actions.",
                    },
                    "y": {
                        "type": "integer",
                        "description": "Y coordinate for mouse actions.",
                    },
                    "text": {
                        "type": "string",
                        "description": (
                            "Text to type (for 'type' action) or key combo "
                            "(for 'key' action, e.g. 'Return', 'ctrl+c')."
                        ),
                    },
                    "end_x": {
                        "type": "integer",
                        "description": "End X coordinate for drag action.",
                    },
                    "end_y": {
                        "type": "integer",
                        "description": "End Y coordinate for drag action.",
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Scroll amount (number of clicks).",
                        "default": 3,
                    },
                },
                "required": ["action"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("computer_use", "desktop", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        action: str = kwargs.get("action", "")
        x: int | None = kwargs.get("x")
        y: int | None = kwargs.get("y")
        text: str = kwargs.get("text", "")
        end_x: int | None = kwargs.get("end_x")
        end_y: int | None = kwargs.get("end_y")
        amount: int = kwargs.get("amount", 3)

        if action not in self._VALID_ACTIONS:
            return ToolResult.fail(
                f"Invalid action '{action}'. "
                f"Must be one of: {', '.join(sorted(self._VALID_ACTIONS))}"
            )

        await _ensure_desktop(session)

        cmd = self._build_command(action, x, y, text, end_x, end_y, amount)
        if cmd is None:
            return ToolResult.fail(
                f"Missing required parameters for action '{action}'"
            )

        result = await session.exec(f"DISPLAY=:99 {cmd}", timeout=10)
        if result.exit_code != 0:
            error = result.stderr or result.stdout or "Unknown error"
            return ToolResult.fail(f"Action '{action}' failed: {error}")

        # Wait a moment for UI to update, then screenshot
        await session.exec("sleep 0.3", timeout=5)
        screenshot_b64 = await _take_screenshot(session)

        metadata: dict[str, Any] = {
            "action": action,
            "screenshot": _SCREENSHOT_PATH,
        }
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        # Include action parameters for frontend rendering
        if x is not None:
            metadata["x"] = x
        if y is not None:
            metadata["y"] = y
        if text:
            metadata["text"] = text
        if end_x is not None:
            metadata["end_x"] = end_x
        if end_y is not None:
            metadata["end_y"] = end_y
        if action in ("scroll_up", "scroll_down"):
            metadata["amount"] = amount

        return ToolResult.ok(
            f"Performed action: {action}",
            metadata=metadata,
        )

    @staticmethod
    def _validate_coords(
        x: int | None,
        y: int | None,
    ) -> bool:
        """Return True if both coordinates are within screen bounds."""
        if x is None or y is None:
            return False
        return 0 <= x <= _SCREEN_WIDTH and 0 <= y <= _SCREEN_HEIGHT

    def _build_command(
        self,
        action: str,
        x: int | None,
        y: int | None,
        text: str,
        end_x: int | None,
        end_y: int | None,
        amount: int,
    ) -> str | None:
        """Build the xdotool command for the given action."""
        if action == "click":
            if not self._validate_coords(x, y):
                return None
            return f"xdotool mousemove {x} {y} click 1"

        if action == "double_click":
            if not self._validate_coords(x, y):
                return None
            return f"xdotool mousemove {x} {y} click --repeat 2 1"

        if action == "right_click":
            if not self._validate_coords(x, y):
                return None
            return f"xdotool mousemove {x} {y} click 3"

        if action == "move":
            if not self._validate_coords(x, y):
                return None
            return f"xdotool mousemove {x} {y}"

        if action == "drag":
            if not self._validate_coords(x, y):
                return None
            if not self._validate_coords(end_x, end_y):
                return None
            return (
                f"xdotool mousemove {x} {y} mousedown 1 "
                f"mousemove {end_x} {end_y} mouseup 1"
            )

        if action == "type":
            if not text:
                return None
            return f"xdotool type --delay 50 {shlex.quote(text)}"

        if action == "key":
            if not text:
                return None
            # Only allow safe xdotool key names (alphanumeric, +, _)
            if not _KEY_NAME_RE.match(text):
                return None
            return f"xdotool key {text}"

        if action == "scroll_up":
            return f"xdotool click --repeat {amount} 4"

        if action == "scroll_down":
            return f"xdotool click --repeat {amount} 5"

        return None
