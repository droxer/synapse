"""Browser automation tools using Playwright inside a sandbox."""

from __future__ import annotations

import json
from typing import Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)

_SCREENSHOT_PATH = "/home/user/.browser/screenshot.png"
_SCRIPT_PATH = "/home/user/.browser/browser_action.py"
_CONFIG_PATH = "/tmp/_browser_config.json"
_WS_FILE = "/home/user/.browser/browser_ws.txt"

_VALID_DIRECTIONS = frozenset({"up", "down"})
_VALID_EXTRACT_TYPES = frozenset({"text", "links", "tables"})


def _build_browser_script(action_code: str) -> str:
    """Wrap action code with Playwright browser setup and screenshot."""
    return f'''\
from playwright.sync_api import sync_playwright
import os

WS_FILE = "{_WS_FILE}"


def get_browser():
    p = sync_playwright().start()
    if os.path.exists(WS_FILE):
        try:
            ws = open(WS_FILE).read().strip()
            browser = p.chromium.connect(ws)
            return p, browser
        except Exception:
            pass
    browser = p.chromium.launch(headless=True, args=["--no-sandbox"])
    return p, browser


p, browser = get_browser()
if browser.contexts:
    page = browser.contexts[0].pages[0]
else:
    page = browser.new_context().new_page()

{action_code}

page.screenshot(path="{_SCREENSHOT_PATH}")
'''


async def _run_browser_script(session: Any, script: str) -> tuple[str, int]:
    """Write and execute a browser script, returning stdout and exit code."""
    await session.write_file(_SCRIPT_PATH, script)
    result = await session.exec(f"python3 {_SCRIPT_PATH}", timeout=60)
    output = result.stdout or ""
    if result.stderr:
        output = f"{output}\n[stderr]\n{result.stderr}" if output else result.stderr
    return output, result.exit_code


async def _capture_screenshot_base64(session: Any) -> str | None:
    """Download screenshot from sandbox and return base64-encoded PNG.

    Uses shell base64 encoding since the sandbox session API only
    supports text file reads (no ``read_file_bytes``).
    """
    try:
        result = await session.exec(f"base64 -w0 {_SCREENSHOT_PATH}", timeout=10)
        if result.exit_code == 0 and result.stdout:
            return result.stdout.strip()
    except Exception as exc:
        logger.debug("screenshot_capture_failed error={}", exc)
    return None


class BrowserNavigate(SandboxTool):
    """Navigate to a URL and take a screenshot."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_navigate",
            description="Navigate the browser to a URL, take a screenshot, and return the page title.",
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
            tags=("browser", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        url: str = kwargs.get("url", "")
        if not url.strip():
            return ToolResult.fail("URL must not be empty")

        await session.write_file(
            _CONFIG_PATH, json.dumps({"url": url})
        )
        action_code = (
            "import json, time\n"
            f'_cfg = json.load(open("{_CONFIG_PATH}"))\n'
            "last_err = None\n"
            "for _attempt in range(3):\n"
            "    try:\n"
            '        page.goto(_cfg["url"], wait_until="domcontentloaded", timeout=30000)\n'
            "        last_err = None\n"
            "        break\n"
            "    except Exception as e:\n"
            "        last_err = e\n"
            "        time.sleep(2)\n"
            "if last_err is not None:\n"
            "    raise last_err\n"
            "print(page.title())"
        )
        script = _build_browser_script(action_code)

        try:
            output, exit_code = await _run_browser_script(session, script)
        except Exception as exc:
            return ToolResult.fail(f"Browser navigation failed: {exc}")

        if exit_code != 0:
            return ToolResult.fail(f"Navigation error (exit {exit_code}): {output}")

        title = output.strip().split("\n")[0] if output.strip() else "Unknown"
        screenshot_b64 = await _capture_screenshot_base64(session)
        metadata: dict[str, Any] = {"screenshot": _SCREENSHOT_PATH, "title": title}
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        return ToolResult.ok(
            f"Navigated to {url}. Page title: {title}",
            metadata=metadata,
        )


class BrowserClick(SandboxTool):
    """Click an element by CSS selector and take a screenshot."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_click",
            description="Click an element matching a CSS selector and take a screenshot.",
            input_schema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector of the element to click.",
                    },
                },
                "required": ["selector"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        selector: str = kwargs.get("selector", "")
        if not selector.strip():
            return ToolResult.fail("Selector must not be empty")

        await session.write_file(
            _CONFIG_PATH, json.dumps({"selector": selector})
        )
        action_code = (
            "import json\n"
            f'_cfg = json.load(open("{_CONFIG_PATH}"))\n'
            'page.click(_cfg["selector"])\npage.wait_for_timeout(500)'
        )
        script = _build_browser_script(action_code)

        try:
            output, exit_code = await _run_browser_script(session, script)
        except Exception as exc:
            return ToolResult.fail(f"Browser click failed: {exc}")

        if exit_code != 0:
            return ToolResult.fail(f"Click error (exit {exit_code}): {output}")

        screenshot_b64 = await _capture_screenshot_base64(session)
        metadata: dict[str, Any] = {"screenshot": _SCREENSHOT_PATH, "selector": selector}
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        return ToolResult.ok(
            f"Clicked element: {selector}",
            metadata=metadata,
        )


class BrowserType(SandboxTool):
    """Type text into an input element by CSS selector."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_type",
            description="Type text into an input element matching a CSS selector and take a screenshot.",
            input_schema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "CSS selector of the input element.",
                    },
                    "text": {
                        "type": "string",
                        "description": "Text to type into the element.",
                    },
                },
                "required": ["selector", "text"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        selector: str = kwargs.get("selector", "")
        text: str = kwargs.get("text", "")

        if not selector.strip():
            return ToolResult.fail("Selector must not be empty")
        if not text:
            return ToolResult.fail("Text must not be empty")

        await session.write_file(
            _CONFIG_PATH, json.dumps({"selector": selector, "text": text})
        )
        action_code = (
            "import json\n"
            f'_cfg = json.load(open("{_CONFIG_PATH}"))\n'
            'page.fill(_cfg["selector"], _cfg["text"])\npage.wait_for_timeout(300)'
        )
        script = _build_browser_script(action_code)

        try:
            output, exit_code = await _run_browser_script(session, script)
        except Exception as exc:
            return ToolResult.fail(f"Browser type failed: {exc}")

        if exit_code != 0:
            return ToolResult.fail(f"Type error (exit {exit_code}): {output}")

        screenshot_b64 = await _capture_screenshot_base64(session)
        metadata: dict[str, Any] = {"screenshot": _SCREENSHOT_PATH, "selector": selector}
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        return ToolResult.ok(
            f"Typed text into: {selector}",
            metadata=metadata,
        )


class BrowserScroll(SandboxTool):
    """Scroll the page up or down by a given number of pixels."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_scroll",
            description="Scroll the browser page up or down and take a screenshot.",
            input_schema={
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "description": "Scroll direction: 'up' or 'down'.",
                        "enum": ["up", "down"],
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Number of pixels to scroll.",
                        "default": 500,
                    },
                },
                "required": ["direction"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        direction: str = kwargs.get("direction", "down").lower()
        amount: int = kwargs.get("amount", 500)

        if direction not in _VALID_DIRECTIONS:
            return ToolResult.fail(
                f"Invalid direction '{direction}'. Must be 'up' or 'down'."
            )
        if amount <= 0:
            return ToolResult.fail("Scroll amount must be a positive integer")

        pixels = -amount if direction == "up" else amount
        action_code = (
            f"page.evaluate('window.scrollBy(0, {pixels})')\npage.wait_for_timeout(300)"
        )
        script = _build_browser_script(action_code)

        try:
            output, exit_code = await _run_browser_script(session, script)
        except Exception as exc:
            return ToolResult.fail(f"Browser scroll failed: {exc}")

        if exit_code != 0:
            return ToolResult.fail(f"Scroll error (exit {exit_code}): {output}")

        screenshot_b64 = await _capture_screenshot_base64(session)
        metadata: dict[str, Any] = {"screenshot": _SCREENSHOT_PATH, "direction": direction}
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        return ToolResult.ok(
            f"Scrolled {direction} by {amount}px",
            metadata=metadata,
        )


_EXTRACT_TEXT_CODE = """\
import json as _json
_cfg = _json.load(open("{config_path}"))
_sel = _cfg.get("selector", "")
target = page.query_selector(_sel) if _sel else None
el = target if target else page
print(el.inner_text())
"""

_EXTRACT_LINKS_CODE = """\
import json as _json
_cfg = _json.load(open("{config_path}"))
_sel = _cfg.get("selector", "")
target = page.query_selector(_sel) if _sel else None
scope = target if target else page
links = scope.eval_on_selector_all(
    "a[href]",
    "els => els.map(e => ({{ text: e.innerText.trim(), href: e.href }}))"
)
for link in links:
    print(f"{{link['text']}} -> {{link['href']}}")
"""

_EXTRACT_TABLES_CODE = """\
import json as _json
_cfg = _json.load(open("{config_path}"))
_sel = _cfg.get("selector", "")
target = page.query_selector(_sel) if _sel else None
scope = target if target else page
tables = scope.eval_on_selector_all(
    "table",
    \"\"\"els => els.map(table => {{
        const rows = Array.from(table.querySelectorAll("tr"));
        return rows.map(row => {{
            const cells = Array.from(row.querySelectorAll("th, td"));
            return cells.map(c => c.innerText.trim());
        }});
    }})\"\"\"
)
for i, table in enumerate(tables):
    print(f"--- Table {{i + 1}} ---")
    for row in table:
        print("\\t".join(row))
"""


def _build_extract_code(extract_type: str) -> str:
    """Return the extraction action code for the given type."""
    templates = {
        "text": _EXTRACT_TEXT_CODE,
        "links": _EXTRACT_LINKS_CODE,
        "tables": _EXTRACT_TABLES_CODE,
    }
    return templates[extract_type].format(config_path=_CONFIG_PATH)


class BrowserExtract(SandboxTool):
    """Extract content from the current page."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_extract",
            description="Extract text, links, or tables from the current browser page.",
            input_schema={
                "type": "object",
                "properties": {
                    "selector": {
                        "type": "string",
                        "description": "Optional CSS selector to scope extraction.",
                    },
                    "extract_type": {
                        "type": "string",
                        "description": "What to extract: 'text', 'links', or 'tables'.",
                        "enum": ["text", "links", "tables"],
                        "default": "text",
                    },
                },
                "required": [],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser", "sandbox"),
        )

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        selector: str = kwargs.get("selector", "")
        extract_type: str = kwargs.get("extract_type", "text").lower()

        if extract_type not in _VALID_EXTRACT_TYPES:
            return ToolResult.fail(
                f"Invalid extract_type '{extract_type}'. "
                f"Must be one of: {', '.join(sorted(_VALID_EXTRACT_TYPES))}"
            )

        await session.write_file(
            _CONFIG_PATH, json.dumps({"selector": selector})
        )
        action_code = _build_extract_code(extract_type)
        script = _build_browser_script(action_code)

        try:
            output, exit_code = await _run_browser_script(session, script)
        except Exception as exc:
            return ToolResult.fail(f"Browser extraction failed: {exc}")

        if exit_code != 0:
            return ToolResult.fail(f"Extract error (exit {exit_code}): {output}")

        screenshot_b64 = await _capture_screenshot_base64(session)
        metadata: dict[str, Any] = {
            "screenshot": _SCREENSHOT_PATH,
            "extract_type": extract_type,
        }
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64
        return ToolResult.ok(
            output.strip() if output.strip() else "(no content extracted)",
            metadata=metadata,
        )
