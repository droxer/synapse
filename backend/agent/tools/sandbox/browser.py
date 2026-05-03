"""Browser automation tool using the browser-use agent inside a sandbox."""

from __future__ import annotations

import json
import shlex
from typing import Any

from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    SandboxTool,
    ToolDefinition,
    ToolResult,
)

_SCRIPT_PATH = "/home/user/.browser/browser_agent.py"
_SCREENSHOT_PATH = "/home/user/.browser/screenshot.png"
_RESULT_START = "__BROWSER_USE_RESULT_START__"
_RESULT_END = "__BROWSER_USE_RESULT_END__"
_MAX_STEPS_LIMIT = 100
_BROWSER_USE_VERSION = "0.12.2"
_DEFAULT_MAX_FAILURES = 5

_BROWSER_USE_SCRIPT = (
    r'''
import asyncio
import base64
import json
import os
import traceback

RESULT_START = "'''
    + _RESULT_START
    + r'''"
RESULT_END = "'''
    + _RESULT_END
    + r'''"
SCREENSHOT_PATH = "'''
    + _SCREENSHOT_PATH
    + r'''"


def _collect_extracted_content(history) -> str:
    """Collect all non-empty extracted_content from action results."""
    parts = []
    try:
        for action_result in history.action_results():
            text = getattr(action_result, "extracted_content", None)
            if text and str(text).strip():
                parts.append(str(text).strip())
    except Exception:
        pass
    return "\n\n".join(parts)


def _collect_errors(history) -> list[str]:
    """Collect error messages from action results."""
    errors = []
    try:
        for action_result in history.action_results():
            err = getattr(action_result, "error", None)
            if err and str(err).strip():
                errors.append(str(err).strip())
    except Exception:
        pass
    return errors


async def main():
    config = json.loads(os.environ["BROWSER_USE_CONFIG"])

    browser = None
    try:
        from browser_use import Agent, Browser, ChatAnthropic

        def _is_tool_choice_thinking_error(exc: Exception) -> bool:
            message = str(exc).lower()
            return "tool_choice" in message and "thinking mode" in message

        class _MessagesWithoutRequiredToolChoiceFallback:
            def __init__(self, messages):
                self._messages = messages

            def __getattr__(self, name):
                return getattr(self._messages, name)

            async def create(self, *args, **kwargs):
                try:
                    return await self._messages.create(*args, **kwargs)
                except Exception as exc:
                    if not kwargs.get("tool_choice") or not _is_tool_choice_thinking_error(exc):
                        raise
                    retry_kwargs = dict(kwargs)
                    retry_kwargs.pop("tool_choice", None)
                    return await self._messages.create(*args, **retry_kwargs)

        class _ClientWithoutRequiredToolChoiceFallback:
            def __init__(self, client):
                self._client = client
                self.messages = _MessagesWithoutRequiredToolChoiceFallback(client.messages)

            def __getattr__(self, name):
                return getattr(self._client, name)

        class SynapseChatAnthropic(ChatAnthropic):
            def get_client(self):
                return _ClientWithoutRequiredToolChoiceFallback(super().get_client())

        llm = SynapseChatAnthropic(
            model=config["model"],
            timeout=120,
        )

        browser = Browser(
            headless=True,
            disable_security=True,
            enable_default_extensions=False,
        )

        task = config["task"]
        if config.get("url"):
            task = f"First navigate to {config['url']}, then: {task}"

        agent = Agent(
            task=task,
            llm=llm,
            browser=browser,
            max_steps=config.get("max_steps", 50),
            max_failures=config.get("max_failures", 5),
            use_vision=True,
            use_thinking=False,
        )

        history = await agent.run()

        output = history.final_result() or ""
        screenshots = history.screenshots()

        # If the agent didn't call done() with a result, collect all
        # extracted content from the action history as fallback
        if not output:
            output = _collect_extracted_content(history)

        errors = _collect_errors(history)

        result = {
            "success": True,
            "output": output,
            "steps": history.number_of_steps(),
            "is_done": history.is_done(),
        }

        if errors:
            result["errors"] = errors

        if screenshots:
            # Write screenshot to file for artifact extraction
            try:
                raw = base64.b64decode(screenshots[-1])
                with open(SCREENSHOT_PATH, "wb") as f:
                    f.write(raw)
                result["screenshot_path"] = SCREENSHOT_PATH
            except Exception:
                pass

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
)


def _parse_result(stdout: str) -> dict[str, Any] | None:
    """Extract the JSON result block from script stdout."""
    start_idx = stdout.find(_RESULT_START)
    end_idx = stdout.find(_RESULT_END)
    if start_idx == -1 or end_idx == -1:
        return None
    json_str = stdout[start_idx + len(_RESULT_START) : end_idx].strip()
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
        model: str = "claude-sonnet-4-6",
        anthropic_base_url: str = "",
        max_failures: int = _DEFAULT_MAX_FAILURES,
    ) -> None:
        self._anthropic_api_key = anthropic_api_key
        self._model = model
        self._anthropic_base_url = anthropic_base_url
        self._max_failures = max_failures

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
        """Ensure browser-use is available in the sandbox."""
        check = await session.exec(
            "python3 -c 'import browser_use'",
            timeout=15,
        )
        if check.exit_code == 0:
            return

        logger.info("Installing browser-use in sandbox")
        install = await session.exec(
            f"pip install -q browser-use=={_BROWSER_USE_VERSION}",
            timeout=180,
        )
        if install.exit_code != 0:
            stderr = install.stderr or install.stdout or "unknown error"
            raise RuntimeError(f"Failed to install browser-use: {stderr}")

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

        # Build config (no secrets — API key passed via env var)
        config = {
            "task": task,
            "url": url,
            "max_steps": max_steps,
            "max_failures": self._max_failures,
            "model": self._model,
        }

        # Write script to sandbox
        try:
            await session.exec("mkdir -p /home/user/.browser", timeout=5)
            await session.write_file(_SCRIPT_PATH, _BROWSER_USE_SCRIPT)
        except Exception as exc:
            return ToolResult.fail(f"Failed to write browser agent files: {exc}")

        # Build env-var based command (API key never touches disk)
        env_prefix = f"ANTHROPIC_API_KEY={shlex.quote(self._anthropic_api_key)}"
        if self._anthropic_base_url:
            env_prefix += f" ANTHROPIC_BASE_URL={shlex.quote(self._anthropic_base_url)}"
        config_json = json.dumps(config)
        cmd = (
            f"{env_prefix} BROWSER_USE_CONFIG={shlex.quote(config_json)} "
            f"python3 {_SCRIPT_PATH}"
        )

        # Execute the browser-use agent (long timeout for multi-step tasks)
        try:
            result = await session.exec(cmd, timeout=300)
        except Exception as exc:
            return ToolResult.fail(f"Browser agent execution failed: {exc}")

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
        errors = parsed.get("errors", [])

        if output:
            summary = output
        elif is_done:
            summary = "(browser agent completed the task but produced no text output)"
        elif errors:
            # Agent stopped early due to errors — surface them
            unique_errors = list(dict.fromkeys(errors))  # dedupe, preserve order
            error_detail = "; ".join(unique_errors[-3:])  # last 3 unique errors
            summary = f"(browser agent stopped due to errors: {error_detail})"
        else:
            summary = "(browser agent completed without producing output)"

        if steps:
            summary += f"\n\n[Completed in {steps} steps]"
        if not is_done:
            summary += "\n[Agent did not reach a final done state]"

        metadata: dict[str, Any] = {
            "steps": steps,
            "is_done": is_done,
            "max_steps": max_steps,
            "url": url or None,
            "task": task,
        }
        screenshot_path = parsed.get("screenshot_path")
        if screenshot_path:
            metadata["artifact_paths"] = [screenshot_path]

        return ToolResult.ok(summary, metadata=metadata)
