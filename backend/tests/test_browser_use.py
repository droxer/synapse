"""Tests for the high-level browser-use sandbox tool."""

from __future__ import annotations

import json
import shlex
from typing import Any

import pytest

from agent.sandbox.base import ExecResult
from agent.tools.sandbox.browser import (
    _RESULT_END,
    _RESULT_START,
    _SCRIPT_PATH,
    BrowserUse,
)


class _FakeBrowserSession:
    def __init__(self) -> None:
        self.commands: list[str] = []
        self.files: dict[str, str] = {}

    async def exec(self, command: str, timeout: int | None = None) -> ExecResult:
        del timeout
        self.commands.append(command)
        if command == "python3 -c 'import browser_use'":
            return ExecResult(stdout="", stderr="", exit_code=0)
        if command == "mkdir -p /home/user/.browser":
            return ExecResult(stdout="", stderr="", exit_code=0)
        if command.endswith(f"python3 {_SCRIPT_PATH}"):
            payload = {
                "success": True,
                "output": "done",
                "steps": 1,
                "is_done": True,
            }
            return ExecResult(
                stdout=f"\n{_RESULT_START}\n{json.dumps(payload)}\n{_RESULT_END}\n",
                stderr="",
                exit_code=0,
            )
        return ExecResult(stdout="", stderr="", exit_code=0)

    async def write_file(self, path: str, content: str) -> None:
        self.files[path] = content


def _browser_command(session: _FakeBrowserSession) -> str:
    for command in session.commands:
        if command.endswith(f"python3 {_SCRIPT_PATH}"):
            return command
    raise AssertionError("browser agent command was not executed")


def _env_value(command: str, name: str) -> Any:
    parts = shlex.split(command)
    prefix = f"{name}="
    for part in parts:
        if part.startswith(prefix):
            return part[len(prefix) :]
    raise AssertionError(f"{name} was not set")


@pytest.mark.asyncio
async def test_browser_use_script_retries_thinking_tool_choice_error() -> None:
    session = _FakeBrowserSession()
    tool = BrowserUse(anthropic_api_key="test-key")

    result = await tool.execute(session, task="Inspect the page")

    assert result.success
    script = session.files[_SCRIPT_PATH]
    assert "SynapseChatAnthropic" in script
    assert "_is_tool_choice_thinking_error" in script
    assert 'retry_kwargs.pop("tool_choice", None)' in script
    assert "use_thinking=False" in script


@pytest.mark.asyncio
async def test_browser_use_shell_quotes_config_and_env() -> None:
    session = _FakeBrowserSession()
    tool = BrowserUse(
        anthropic_api_key="key with space",
        anthropic_base_url="https://example.test/custom path",
    )

    result = await tool.execute(session, task="Click Bob's profile")

    assert result.success
    command = _browser_command(session)
    config = json.loads(_env_value(command, "BROWSER_USE_CONFIG"))
    assert config["task"] == "Click Bob's profile"
    assert _env_value(command, "ANTHROPIC_API_KEY") == "key with space"
    assert (
        _env_value(command, "ANTHROPIC_BASE_URL") == "https://example.test/custom path"
    )
