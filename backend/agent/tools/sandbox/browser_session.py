"""Persistent browser session manager for granular browser tools.

Manages a Playwright browser instance inside the sandbox that persists
across tool calls within a conversation turn.  Each action returns a
DOM-indexed state of the page so the LLM can reference elements by index.
"""

from __future__ import annotations

import json
from typing import Any

from loguru import logger

_SESSION_DIR = "/home/user/.browser_session"
_DRIVER_PATH = f"{_SESSION_DIR}/driver.py"
_CMD_FILE = f"{_SESSION_DIR}/cmd.json"
_RESULT_FILE = f"{_SESSION_DIR}/result.json"
_PID_FILE = f"{_SESSION_DIR}/pid"
_SCREENSHOT_PATH = f"{_SESSION_DIR}/screenshot.png"
_READY_FILE = f"{_SESSION_DIR}/ready"
_DOWNLOADS_DIR = f"{_SESSION_DIR}/downloads"
_STORAGE_STATE_PATH = f"{_SESSION_DIR}/storage_state.json"

_RESULT_START = "__BROWSER_CMD_RESULT_START__"
_RESULT_END = "__BROWSER_CMD_RESULT_END__"

# Interactive selectors used for DOM indexing — matches Manus's approach
_INTERACTIVE_SELECTORS = (
    "a[href]",
    "button",
    "input",
    "textarea",
    "select",
    "[role='button']",
    "[role='link']",
    "[role='tab']",
    "[role='menuitem']",
    "[onclick]",
    "[contenteditable='true']",
)

# fmt: off
_DRIVER_SCRIPT = r'''
"""Persistent Playwright browser driver.

Reads commands from a JSON file, executes them, writes results back.
Runs as a long-lived process inside the sandbox.
"""
import asyncio
import base64
import json
import os
import signal
import sys
import traceback

SESSION_DIR = "''' + _SESSION_DIR + r'''"
CMD_FILE = SESSION_DIR + "/cmd.json"
RESULT_FILE = SESSION_DIR + "/result.json"
PID_FILE = SESSION_DIR + "/pid"
SCREENSHOT_PATH = SESSION_DIR + "/screenshot.png"
READY_FILE = SESSION_DIR + "/ready"
DOWNLOADS_DIR = SESSION_DIR + "/downloads"
STORAGE_STATE_PATH = SESSION_DIR + "/storage_state.json"
RESULT_START = "''' + _RESULT_START + r'''"
RESULT_END = "''' + _RESULT_END + r'''"

INTERACTIVE_SELECTORS = ''' + json.dumps(list(_INTERACTIVE_SELECTORS)) + r'''

async def get_dom_state(page):
    """Return indexed interactive elements from the current page."""
    selector = ", ".join(INTERACTIVE_SELECTORS)
    elements = await page.query_selector_all(selector)

    indexed = []
    for i, el in enumerate(elements):
        try:
            tag = await el.evaluate("e => e.tagName.toLowerCase()")
            text = (await el.inner_text())[:80] if await el.is_visible() else ""
            attrs = await el.evaluate("""e => {
                const a = {};
                for (const attr of ['href', 'placeholder', 'value', 'type', 'name', 'aria-label', 'role', 'src']) {
                    if (e.hasAttribute(attr)) a[attr] = e.getAttribute(attr);
                }
                return a;
            }""")
            visible = await el.is_visible()
            bbox = await el.bounding_box()
            indexed.append({
                "index": i,
                "tag": tag,
                "text": text.strip().replace("\n", " "),
                "attributes": attrs,
                "visible": visible,
                "bbox": [int(bbox["x"]), int(bbox["y"]), int(bbox["width"]), int(bbox["height"])] if bbox else None,
            })
        except Exception:
            continue

    return indexed


async def list_downloads():
    if not os.path.isdir(DOWNLOADS_DIR):
        return []
    files = []
    for name in sorted(os.listdir(DOWNLOADS_DIR)):
        path = os.path.join(DOWNLOADS_DIR, name)
        if not os.path.isfile(path):
            continue
        stat = os.stat(path)
        files.append({
            "name": name,
            "path": path,
            "size": stat.st_size,
        })
    return files


async def build_state(page, take_screenshot=True):
    """Build the full browser state response."""
    url = page.url
    title = await page.title()
    elements = await get_dom_state(page)
    scroll = await page.evaluate("() => ({ x: window.scrollX, y: window.scrollY, height: document.body.scrollHeight })")

    state = {
        "url": url,
        "title": title,
        "elements": elements,
        "scroll_x": scroll["x"],
        "scroll_y": scroll["y"],
        "page_height": scroll["height"],
        "downloads": await list_downloads(),
    }

    if take_screenshot:
        try:
            await page.screenshot(path=SCREENSHOT_PATH)
            state["screenshot_path"] = SCREENSHOT_PATH
        except Exception:
            pass

    return state


async def handle_command(page, context, cmd, recreate_context):
    """Execute a single command and return the result."""
    action = cmd.get("action", "")

    if action == "navigate":
        url = cmd["url"]
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_load_state("networkidle", timeout=10000)
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "view":
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "click":
        if "index" in cmd:
            selector = ", ".join(INTERACTIVE_SELECTORS)
            elements = await page.query_selector_all(selector)
            idx = cmd["index"]
            if idx < 0 or idx >= len(elements):
                return {"success": False, "error": f"Element index {idx} out of range (0-{len(elements)-1})"}, context, page
            await elements[idx].click()
        elif "x" in cmd and "y" in cmd:
            await page.mouse.click(cmd["x"], cmd["y"])
        else:
            return {"success": False, "error": "click requires 'index' or 'x'+'y'"}, context, page
        await page.wait_for_load_state("networkidle", timeout=10000)
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "input":
        selector = ", ".join(INTERACTIVE_SELECTORS)
        elements = await page.query_selector_all(selector)
        idx = cmd["index"]
        if idx < 0 or idx >= len(elements):
            return {"success": False, "error": f"Element index {idx} out of range (0-{len(elements)-1})"}, context, page
        el = elements[idx]
        if cmd.get("clear", True):
            await el.fill("")
        await el.fill(cmd["text"])
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "select":
        selector = ", ".join(INTERACTIVE_SELECTORS)
        elements = await page.query_selector_all(selector)
        idx = cmd["index"]
        if idx < 0 or idx >= len(elements):
            return {"success": False, "error": f"Element index {idx} out of range"}, context, page
        await elements[idx].select_option(cmd["value"])
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "scroll_up":
        pixels = cmd.get("pixels", 500)
        await page.evaluate(f"window.scrollBy(0, -{pixels})")
        await asyncio.sleep(0.3)
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "scroll_down":
        pixels = cmd.get("pixels", 500)
        await page.evaluate(f"window.scrollBy(0, {pixels})")
        await asyncio.sleep(0.3)
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "press_key":
        await page.keyboard.press(cmd["key"])
        await asyncio.sleep(0.5)
        return {"success": True, "state": await build_state(page)}, context, page

    elif action == "console_exec":
        try:
            result = await page.evaluate(cmd["script"])
            return {"success": True, "result": json.dumps(result, default=str)[:2000], "state": await build_state(page, take_screenshot=False)}, context, page
        except Exception as e:
            return {"success": False, "error": str(e)}, context, page

    elif action == "console_view":
        # Console logs are collected via the listener set up at launch
        return {"success": True, "logs": console_logs[-50:], "state": await build_state(page, take_screenshot=False)}, context, page

    elif action == "upload":
        selector = ", ".join(INTERACTIVE_SELECTORS)
        elements = await page.query_selector_all(selector)
        idx = cmd["index"]
        if idx < 0 or idx >= len(elements):
            return {"success": False, "error": f"Element index {idx} out of range"}, context, page
        file_paths = cmd.get("paths") or ([cmd["path"]] if cmd.get("path") else [])
        if not file_paths:
            return {"success": False, "error": "upload requires path or paths"}, context, page
        await elements[idx].set_input_files(file_paths)
        return {"success": True, "uploaded_paths": file_paths, "state": await build_state(page)}, context, page

    elif action == "save_session":
        path = cmd.get("path") or STORAGE_STATE_PATH
        await context.storage_state(path=path)
        return {"success": True, "path": path, "state": await build_state(page, take_screenshot=False)}, context, page

    elif action == "load_session":
        path = cmd.get("path") or STORAGE_STATE_PATH
        if not os.path.exists(path):
            return {"success": False, "error": f"Storage state not found: {path}"}, context, page
        await context.close()
        next_context, next_page = await recreate_context(path)
        url = cmd.get("url")
        if url:
            await next_page.goto(url, wait_until="domcontentloaded", timeout=30000)
            await next_page.wait_for_load_state("networkidle", timeout=10000)
        return {"success": True, "path": path, "state": await build_state(next_page)}, next_context, next_page

    elif action == "list_downloads":
        downloads = await list_downloads()
        return {
            "success": True,
            "downloads": downloads,
            "state": await build_state(page, take_screenshot=False),
        }, context, page

    else:
        return {"success": False, "error": f"Unknown action: {action}"}, context, page


console_logs = []

async def main():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        )
        os.makedirs(DOWNLOADS_DIR, exist_ok=True)

        async def _save_download(download):
            target = os.path.join(DOWNLOADS_DIR, download.suggested_filename)
            await download.save_as(target)

        async def create_context(storage_state_path=None):
            if storage_state_path and not os.path.exists(storage_state_path):
                storage_state_path = None
            context = await browser.new_context(
                viewport={"width": 1280, "height": 720},
                accept_downloads=True,
                storage_state=storage_state_path,
            )
            page = await context.new_page()
            page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
            page.on("download", lambda download: asyncio.create_task(_save_download(download)))
            return context, page

        context, page = await create_context()

        # Signal ready
        with open(READY_FILE, "w") as f:
            f.write("ready")

        # Command loop: read cmd.json, execute, write result.json
        while True:
            try:
                if not os.path.exists(CMD_FILE):
                    await asyncio.sleep(0.1)
                    continue

                with open(CMD_FILE, "r") as f:
                    cmd = json.load(f)
                os.remove(CMD_FILE)

                if cmd.get("action") == "shutdown":
                    break

                result, context, page = await handle_command(page, context, cmd, create_context)

            except Exception as e:
                result = {"success": False, "error": str(e), "traceback": traceback.format_exc()}

            with open(RESULT_FILE, "w") as f:
                json.dump(result, f)

        await context.close()
        await browser.close()

asyncio.run(main())
'''
# fmt: on


def format_dom_state(state: dict[str, Any]) -> str:
    """Format browser state as human-readable text for the LLM."""
    lines: list[str] = []
    lines.append(f"URL: {state.get('url', 'about:blank')}")
    lines.append(f"Title: {state.get('title', '(no title)')}")
    lines.append("")

    elements = state.get("elements", [])
    visible_elements = [e for e in elements if e.get("visible", True)]

    if visible_elements:
        lines.append("Interactive Elements:")
        for el in visible_elements:
            idx = el["index"]
            tag = el["tag"]
            text = el.get("text", "")
            attrs = el.get("attributes", {})

            # Build a concise representation
            attr_parts: list[str] = []
            for key in (
                "href",
                "type",
                "placeholder",
                "value",
                "name",
                "aria-label",
                "src",
            ):
                val = attrs.get(key)
                if val:
                    # Truncate long attribute values
                    display_val = val[:60] + "..." if len(val) > 60 else val
                    attr_parts.append(f'{key}="{display_val}"')

            attr_str = " " + " ".join(attr_parts) if attr_parts else ""
            text_str = text[:60] if text else ""

            if text_str:
                lines.append(f"[{idx}] <{tag}{attr_str}>{text_str}</{tag}>")
            else:
                lines.append(f"[{idx}] <{tag}{attr_str} />")
    else:
        lines.append("(no interactive elements found)")

    # Scroll position
    scroll_y = state.get("scroll_y", 0)
    page_height = state.get("page_height", 0)
    lines.append("")
    lines.append(f"Page scroll: {scroll_y}/{page_height}")

    return "\n".join(lines)


async def ensure_browser_driver(session: Any) -> bool:
    """Start the browser driver process if not already running.

    Returns True if the driver is ready, False on failure.
    """
    # Check if already running
    check = await session.exec(f"test -f {_READY_FILE}", timeout=5)
    if check.exit_code == 0:
        # Verify PID is still alive
        pid_check = await session.exec(
            f"test -f {_PID_FILE} && kill -0 $(cat {_PID_FILE}) 2>/dev/null",
            timeout=5,
        )
        if pid_check.exit_code == 0:
            return True

    # Start the driver
    logger.info("Starting browser session driver in sandbox")
    await session.exec(f"mkdir -p {_SESSION_DIR}", timeout=5)
    await session.write_file(_DRIVER_PATH, _DRIVER_SCRIPT)

    # Remove stale ready/result files
    await session.exec(
        f"rm -f {_READY_FILE} {_RESULT_FILE} {_CMD_FILE}",
        timeout=5,
    )

    # Launch driver in background
    result = await session.exec(
        f"nohup python3 {_DRIVER_PATH} > {_SESSION_DIR}/driver.log 2>&1 & echo $!",
        timeout=10,
    )
    pid = result.stdout.strip()
    if not pid:
        logger.error("Failed to start browser driver: no PID returned")
        return False

    await session.write_file(_PID_FILE, pid)

    # Wait for ready signal (up to 15 seconds)
    wait_result = await session.exec(
        f"for i in $(seq 1 30); do "
        f"  test -f {_READY_FILE} && exit 0; "
        f"  sleep 0.5; "
        f"done; exit 1",
        timeout=20,
    )

    if wait_result.exit_code != 0:
        # Check driver log for errors
        log = await session.exec(
            f"cat {_SESSION_DIR}/driver.log 2>/dev/null", timeout=5
        )
        logger.error("Browser driver failed to start: {}", log.stdout)
        return False

    logger.info("Browser session driver ready (PID: {})", pid)
    return True


async def send_browser_command(
    session: Any,
    command: dict[str, Any],
    timeout: int = 30,
) -> dict[str, Any]:
    """Send a command to the browser driver and return the result.

    The protocol is file-based: write command JSON → driver reads & executes
    → driver writes result JSON → we read result.
    """
    # Ensure driver is running
    ready = await ensure_browser_driver(session)
    if not ready:
        return {"success": False, "error": "Browser driver is not running"}

    # Remove stale result
    await session.exec(f"rm -f {_RESULT_FILE}", timeout=5)

    # Write command
    cmd_json = json.dumps(command)
    await session.write_file(_CMD_FILE, cmd_json)

    # Poll for result (file-based IPC)
    poll_result = await session.exec(
        f"for i in $(seq 1 {timeout * 2}); do "
        f"  test -f {_RESULT_FILE} && cat {_RESULT_FILE} && exit 0; "
        f"  sleep 0.5; "
        f"done; exit 1",
        timeout=timeout + 5,
    )

    if poll_result.exit_code != 0:
        return {
            "success": False,
            "error": f"Browser command timed out after {timeout}s",
        }

    try:
        return json.loads(poll_result.stdout)
    except json.JSONDecodeError:
        return {
            "success": False,
            "error": f"Invalid result JSON: {poll_result.stdout[:200]}",
        }
