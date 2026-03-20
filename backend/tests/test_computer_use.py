"""Tests for computer use tools."""

from __future__ import annotations

import pytest

from agent.sandbox.base import ExecResult
from agent.tools.base import ExecutionContext
from agent.tools.sandbox.computer_use import ComputerAction, ComputerScreenshot


class TestComputerScreenshot:
    def test_definition(self) -> None:
        tool = ComputerScreenshot()
        defn = tool.definition()
        assert defn.name == "computer_screenshot"
        assert defn.execution_context == ExecutionContext.SANDBOX
        assert "computer_use" in defn.tags


class TestComputerAction:
    def test_definition(self) -> None:
        tool = ComputerAction()
        defn = tool.definition()
        assert defn.name == "computer_action"
        assert "action" in defn.input_schema["required"]

    # ── Click / mouse actions ──────────────────────────────────────

    def test_build_click_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("click", 100, 200, "", None, None, 3)
        assert cmd is not None
        assert "100" in cmd and "200" in cmd

    def test_build_click_missing_coords(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("click", None, None, "", None, None, 3) is None

    def test_build_double_click_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("double_click", 50, 60, "", None, None, 3)
        assert cmd is not None
        assert "50" in cmd and "60" in cmd
        assert "--repeat 2" in cmd

    def test_build_right_click_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("right_click", 50, 60, "", None, None, 3)
        assert cmd is not None
        assert "click 3" in cmd

    def test_build_move_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("move", 50, 60, "", None, None, 3)
        assert cmd is not None
        assert "mousemove" in cmd

    def test_build_drag_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("drag", 10, 20, "", 100, 200, 3)
        assert cmd is not None
        assert "10" in cmd and "200" in cmd

    # ── Type action (S2 — shlex.quote) ─────────────────────────────

    def test_build_type_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("type", None, None, "hello", None, None, 3)
        assert cmd is not None
        assert "hello" in cmd

    def test_build_type_missing_text(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("type", None, None, "", None, None, 3) is None

    def test_type_escapes_shell_metacharacters(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("type", None, None, "$(rm -rf /)", None, None, 3)
        assert cmd is not None
        # shlex.quote wraps in single quotes, preventing expansion
        assert "$(rm -rf /)" in cmd
        assert cmd.startswith("xdotool type --delay 50 ")

    def test_type_escapes_single_quotes(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("type", None, None, "it's a test", None, None, 3)
        assert cmd is not None
        # shlex.quote handles embedded single quotes safely
        assert "it" in cmd and "test" in cmd

    def test_type_escapes_backticks(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("type", None, None, "`whoami`", None, None, 3)
        assert cmd is not None

    # ── Key action (S1 — regex validation) ─────────────────────────

    def test_build_key_command(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("key", None, None, "Return", None, None, 3)
        assert cmd is not None
        assert "Return" in cmd

    def test_key_allows_combos(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("key", None, None, "ctrl+c", None, None, 3)
        assert cmd is not None
        assert cmd == "xdotool key ctrl+c"

    def test_key_allows_underscored_names(self) -> None:
        tool = ComputerAction()
        cmd = tool._build_command("key", None, None, "Page_Down", None, None, 3)
        assert cmd is not None

    def test_key_rejects_shell_injection(self) -> None:
        tool = ComputerAction()
        # Semicolons, pipes, backticks, spaces, $() should all be rejected
        assert tool._build_command("key", None, None, "Return; rm -rf /", None, None, 3) is None
        assert tool._build_command("key", None, None, "a | b", None, None, 3) is None
        assert tool._build_command("key", None, None, "`whoami`", None, None, 3) is None
        assert tool._build_command("key", None, None, "$(id)", None, None, 3) is None
        assert tool._build_command("key", None, None, "a b", None, None, 3) is None

    def test_key_rejects_empty(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("key", None, None, "", None, None, 3) is None

    # ── Scroll ─────────────────────────────────────────────────────

    def test_scroll_commands(self) -> None:
        tool = ComputerAction()
        up = tool._build_command("scroll_up", None, None, "", None, None, 5)
        down = tool._build_command("scroll_down", None, None, "", None, None, 5)
        assert up is not None and "4" in up  # button 4 = scroll up
        assert down is not None and "5" in down  # button 5 = scroll down

    def test_scroll_amount(self) -> None:
        tool = ComputerAction()
        up = tool._build_command("scroll_up", None, None, "", None, None, 5)
        assert up is not None
        assert "--repeat 5" in up

    # ── Bounds checking (C5) ───────────────────────────────────────

    def test_negative_coords_rejected(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("click", -1, 100, "", None, None, 3) is None
        assert tool._build_command("click", 100, -1, "", None, None, 3) is None

    def test_coords_exceeding_screen_rejected(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("click", 1281, 100, "", None, None, 3) is None
        assert tool._build_command("click", 100, 721, "", None, None, 3) is None

    def test_coords_at_boundary_accepted(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("click", 0, 0, "", None, None, 3) is not None
        assert tool._build_command("click", 1280, 720, "", None, None, 3) is not None

    def test_drag_end_coords_validated(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("drag", 10, 20, "", -1, 200, 3) is None
        assert tool._build_command("drag", 10, 20, "", 100, 1000, 3) is None

    # ── Unknown / invalid actions ──────────────────────────────────

    def test_unknown_action_returns_none(self) -> None:
        tool = ComputerAction()
        assert tool._build_command("unknown_action", None, None, "", None, None, 3) is None

    @pytest.mark.asyncio
    async def test_invalid_action_fails(self) -> None:
        tool = ComputerAction()

        class MockSession:
            async def exec(self, *a, **kw):
                return ExecResult(stdout="", stderr="", exit_code=0)

        result = await tool.execute(session=MockSession(), action="invalid_action")
        assert not result.success
