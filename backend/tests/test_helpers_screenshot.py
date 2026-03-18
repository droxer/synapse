"""Tests for screenshot support in helpers."""

from __future__ import annotations

from agent.runtime.helpers import build_tool_result_block


class TestBuildToolResultBlock:
    def test_basic_text_only(self) -> None:
        block = build_tool_result_block("id1", "output text", True)
        assert block["tool_use_id"] == "id1"
        # When no screenshot and there is text, content falls back to the
        # plain string (the list has one element, but the implementation
        # uses `content if content else output` which yields a list).
        assert block["content"] == [{"type": "text", "text": "output text"}]
        assert "is_error" not in block

    def test_error_block(self) -> None:
        block = build_tool_result_block("id1", "error msg", False)
        assert block["is_error"] is True

    def test_with_screenshot(self) -> None:
        block = build_tool_result_block(
            "id1", "navigated", True, screenshot_base64="AAAA"
        )
        assert isinstance(block["content"], list)
        assert len(block["content"]) == 2
        assert block["content"][0]["type"] == "text"
        assert block["content"][1]["type"] == "image"
        assert block["content"][1]["source"]["data"] == "AAAA"

    def test_screenshot_without_text(self) -> None:
        block = build_tool_result_block("id1", "", True, screenshot_base64="BBBB")
        assert isinstance(block["content"], list)
        # Should have image only (no empty text block)
        types = [c["type"] for c in block["content"]]
        assert "image" in types
        assert "text" not in types

    def test_empty_output_no_screenshot(self) -> None:
        block = build_tool_result_block("id1", "", True)
        # With empty output and no screenshot, content list is empty so
        # the implementation falls back to the output string itself.
        assert block["content"] == ""
