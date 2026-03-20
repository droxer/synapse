"""Browser automation tool using the browser-use agent inside a sandbox."""

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

_CONFIG_PATH = "/home/user/.browser/config.json"
_SCRIPT_PATH = "/home/user/.browser/browser_agent.py"
_RESULT_START = "__BROWSER_USE_RESULT_START__"
_RESULT_END = "__BROWSER_USE_RESULT_END__"
_MAX_STEPS_LIMIT = 100

_BROWSER_USE_SCRIPT = r'''
import asyncio
import json
import os
import traceback

CONFIG_PATH = "''' + _CONFIG_PATH + r'''"
RESULT_START = "''' + _RESULT_START + r'''"
RESULT_END = "''' + _RESULT_END + r'''"


async def main():
    with open(CONFIG_PATH) as f:
        config = json.load(f)

    os.environ["ANTHROPIC_API_KEY"] = config["api_key"]
    if config.get("base_url"):
        os.environ["ANTHROPIC_BASE_URL"] = config["base_url"]

    browser = None
    try:
        from browser_use import Agent, Browser, ChatAnthropic

        llm = ChatAnthropic(
            model=config["model"],
            timeout=120,
        )

        browser = Browser(
            headless=True,
            disable_security=True,
        )

        task = config["task"]
        if config.get("url"):
            task = f"First navigate to {config['url']}, then: {task}"

        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            max_steps=config.get("max_steps", 50),
            use_vision=True,
        )

        history = await agent.run()

        output = history.final_result() or ""
        screenshots = history.screenshots()

        result = {
            "success": True,
            "output": output,
            "steps": history.number_of_steps(),
            "is_done": history.is_done(),
        }

        if screenshots:
            result["screenshot_base64"] = screenshots[-1]

    except Exception as e:
        result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
    finally:
        if browser is not None:
            try:
                await browser.close()
            except Exception:
                pass

    print(f"\n{RESULT_START}")
    print(json.dumps(result))
    print(RESULT_END)


asyncio.run(main())
'''


def _parse_result(stdout: str) -> dict[str, Any] | None:
    """Extract the JSON result block from script stdout."""
    start_idx = stdout.find(_RESULT_START)
    end_idx = stdout.find(_RESULT_END)
    if start_idx == -1 or end_idx == -1:
        return None
    json_str = stdout[start_idx + len(_RESULT_START):end_idx].strip()
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        return None


class BrowserUse(SandboxTool):
    """Browser automation tool that delegates tasks to a browser-use agent.

    The agent runs autonomously inside the sandbox — navigating, clicking,
    typing, and extracting content based on a natural-language task
    description. No CSS selectors or low-level actions required.
    """

    def __init__(
        self,
        anthropic_api_key: str,
        model: str = "claude-sonnet-4-20250514",
        anthropic_base_url: str = "",
    ) -> None:
        self._anthropic_api_key = anthropic_api_key
        self._model = model
        self._anthropic_base_url = anthropic_base_url

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="browser_use",
            description=(
                "Execute a browser task using an AI-powered browser agent. "
                "Describe what you want to accomplish in natural language and "
                "the agent will autonomously navigate, click, type, and extract "
                "content. A screenshot of the final state is returned."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": (
                            "Natural language description of the browser task "
                            "to perform (e.g. 'Find the top story on Hacker News')."
                        ),
                    },
                    "url": {
                        "type": "string",
                        "description": "Optional starting URL to navigate to before executing the task.",
                    },
                    "max_steps": {
                        "type": "integer",
                        "description": "Maximum number of browser actions the agent may take.",
                        "default": 50,
                    },
                },
                "required": ["task"],
            },
            execution_context=ExecutionContext.SANDBOX,
            tags=("browser",),
        )

    async def _ensure_installed(self, session: Any) -> None:
        """Ensure browser-use and xdotool are available in the sandbox."""
        # xdotool (needed by browser-use for click actions)
        xdotool_check = await session.exec("which xdotool", timeout=5)
        if xdotool_check.exit_code != 0:
            logger.info("Installing xdotool in sandbox")
            await session.exec(
                "apt-get update -qq && apt-get install -y -qq xdotool >/dev/null 2>&1",
                timeout=60,
            )

        # browser-use python package
        check = await session.exec(
            "python3 -c 'import browser_use'",
            timeout=15,
        )
        if check.exit_code == 0:
            return

        logger.info("Installing browser-use in sandbox")
        install = await session.exec(
            "pip install -q browser-use",
            timeout=180,
        )
        if install.exit_code != 0:
            stderr = install.stderr or install.stdout or "unknown error"
            raise RuntimeError(f"Failed to install browser-use: {stderr}")

    async def _cleanup_config(self, session: Any) -> None:
        """Remove the config file containing the API key from the sandbox."""
        try:
            await session.exec(f"rm -f {_CONFIG_PATH}", timeout=5)
        except Exception:
            logger.debug("Failed to clean up browser config file")

    async def execute(self, session: Any, **kwargs: Any) -> ToolResult:
        task: str = kwargs.get("task", "")
        url: str = kwargs.get("url", "")
        max_steps: int = min(kwargs.get("max_steps", 50), _MAX_STEPS_LIMIT)

        if not task.strip():
            return ToolResult.fail("Task description must not be empty")

        # Ensure dependencies are installed
        try:
            await self._ensure_installed(session)
        except RuntimeError as exc:
            return ToolResult.fail(str(exc))

        # Write config and script to sandbox
        config = {
            "task": task,
            "url": url,
            "max_steps": max_steps,
            "api_key": self._anthropic_api_key,
            "base_url": self._anthropic_base_url,
            "model": self._model,
        }
        try:
            await session.exec("mkdir -p /home/user/.browser", timeout=5)
            await session.write_file(_CONFIG_PATH, json.dumps(config))
            await session.write_file(_SCRIPT_PATH, _BROWSER_USE_SCRIPT)
        except Exception as exc:
            await self._cleanup_config(session)
            return ToolResult.fail(f"Failed to write browser agent files: {exc}")

        # Execute the browser-use agent (long timeout for multi-step tasks)
        try:
            result = await session.exec(
                f"python3 {_SCRIPT_PATH}",
                timeout=300,
            )
        except Exception as exc:
            await self._cleanup_config(session)
            return ToolResult.fail(f"Browser agent execution failed: {exc}")

        # Always clean up config file containing API key
        await self._cleanup_config(session)

        # Parse the structured result
        stdout = result.stdout or ""
        parsed = _parse_result(stdout)

        if parsed is None:
            error_info = result.stderr or ""
            if result.exit_code != 0:
                return ToolResult.fail(
                    f"Browser agent failed (exit {result.exit_code}): "
                    f"{stdout}\n{error_info}".strip()
                )
            return ToolResult.ok(stdout.strip() or "(no output)")

        if not parsed.get("success"):
            error_msg = parsed.get("error", "Unknown error")
            tb = parsed.get("traceback", "")
            logger.debug("browser_use_error traceback={}", tb)
            return ToolResult.fail(f"Browser agent error: {error_msg}")

        # Build successful result
        output = parsed.get("output", "")
        steps = parsed.get("steps", 0)
        is_done = parsed.get("is_done", False)

        summary = output if output else "(browser agent completed with no text output)"
        if steps:
            summary += f"\n\n[Completed in {steps} steps]"
        if not is_done:
            summary += "\n[Warning: agent did not reach a final done state]"

        metadata: dict[str, Any] = {
            "steps": steps,
            "is_done": is_done,
        }
        screenshot_b64 = parsed.get("screenshot_base64")
        if screenshot_b64:
            metadata["screenshot_base64"] = screenshot_b64

        return ToolResult.ok(summary, metadata=metadata)
