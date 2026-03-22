"""Tests for the context compaction observer."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from agent.runtime.observer import (
    Observer,
    _compact_content_block,
    _compute_full_boundary,
    _estimate_tokens,
    _find_tool_interaction_indices,
    _flatten_content,
    _truncate_tool_result,
)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------


def _user_msg(text: str) -> dict[str, Any]:
    return {"role": "user", "content": text}


def _assistant_msg(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": text}


def _tool_use_msg(name: str, input_data: dict | None = None) -> dict[str, Any]:
    return {
        "role": "assistant",
        "content": [
            {
                "type": "tool_use",
                "id": f"call_{name}",
                "name": name,
                "input": input_data or {},
            },
        ],
    }


def _tool_result_msg(content: str, tool_use_id: str = "call_x") -> dict[str, Any]:
    return {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": tool_use_id, "content": content},
        ],
    }


def _tool_result_list_msg(
    blocks: list[dict], tool_use_id: str = "call_x"
) -> dict[str, Any]:
    return {
        "role": "user",
        "content": [
            {"type": "tool_result", "tool_use_id": tool_use_id, "content": blocks},
        ],
    }


def _image_block() -> dict[str, Any]:
    return {"type": "image", "source": {"type": "base64", "data": "abc123"}}


# ------------------------------------------------------------------
# Token estimation
# ------------------------------------------------------------------


class TestEstimateTokens:
    def test_empty_messages(self) -> None:
        assert _estimate_tokens(()) == 0

    def test_with_system_prompt(self) -> None:
        tokens = _estimate_tokens((), system_prompt="a" * 400)
        assert tokens == 100  # 400 chars / 4

    def test_proportional_to_content(self) -> None:
        small = (_user_msg("hi"),)
        large = (_user_msg("x" * 4000),)
        assert _estimate_tokens(large) > _estimate_tokens(small)


# ------------------------------------------------------------------
# Pure helpers
# ------------------------------------------------------------------


class TestFindToolInteractionIndices:
    def test_no_tool_results(self) -> None:
        msgs = [_user_msg("hi"), _assistant_msg("hello")]
        assert _find_tool_interaction_indices(msgs) == ()

    def test_mixed_messages(self) -> None:
        msgs = [
            _assistant_msg("thinking"),
            _tool_result_msg("result1"),
            _assistant_msg("more thinking"),
            _tool_result_msg("result2"),
        ]
        assert _find_tool_interaction_indices(msgs) == (1, 3)


class TestComputeFullBoundary:
    def test_empty_indices(self) -> None:
        assert _compute_full_boundary((), max_full=5) == 0

    def test_fewer_than_max(self) -> None:
        assert _compute_full_boundary((1, 3), max_full=5) == 0

    def test_exact_max(self) -> None:
        assert _compute_full_boundary((1, 3, 5), max_full=3) == 0

    def test_exceeds_max(self) -> None:
        assert _compute_full_boundary((1, 3, 5, 7, 9, 11), max_full=3) == 7


class TestFlattenContent:
    def test_string(self) -> None:
        assert _flatten_content("hello") == "hello"

    def test_list_of_dicts(self) -> None:
        blocks = [{"text": "a"}, {"text": "b"}]
        assert _flatten_content(blocks) == "a b"

    def test_list_of_strings(self) -> None:
        assert _flatten_content(["a", "b"]) == "a b"

    def test_other_type(self) -> None:
        assert _flatten_content(42) == "42"


class TestTruncateToolResult:
    def test_short_string_untouched(self) -> None:
        block = {"type": "tool_result", "content": "short"}
        assert _truncate_tool_result(block) is block

    def test_long_string_truncated(self) -> None:
        block = {"type": "tool_result", "content": "x" * 200}
        result = _truncate_tool_result(block)
        assert "truncated" in result["content"]
        assert len(result["content"]) < 200

    def test_list_content_short_untouched(self) -> None:
        block = {"type": "tool_result", "content": [{"text": "short"}]}
        assert _truncate_tool_result(block) is block

    def test_list_content_long_truncated(self) -> None:
        block = {"type": "tool_result", "content": [{"text": "y" * 200}]}
        result = _truncate_tool_result(block)
        assert "truncated" in result["content"]

    def test_non_string_non_list_untouched(self) -> None:
        block = {"type": "tool_result", "content": 42}
        assert _truncate_tool_result(block) is block


class TestCompactContentBlock:
    def test_non_dict_passthrough(self) -> None:
        assert _compact_content_block("text") == "text"

    def test_image_replaced(self) -> None:
        result = _compact_content_block(_image_block())
        assert result["source"] == "[screenshot captured]"

    def test_screenshot_text_replaced(self) -> None:
        block = {"type": "text", "text": "Here is the screenshot result"}
        result = _compact_content_block(block)
        assert result["text"] == "[screenshot captured]"

    def test_normal_text_untouched(self) -> None:
        block = {"type": "text", "text": "normal content"}
        assert _compact_content_block(block) is block


# ------------------------------------------------------------------
# Observer
# ------------------------------------------------------------------


class TestObserverInit:
    def test_rejects_zero_interactions(self) -> None:
        with pytest.raises(ValueError, match="max_full_interactions"):
            Observer(max_full_interactions=0)

    def test_rejects_zero_budget(self) -> None:
        with pytest.raises(ValueError, match="token_budget"):
            Observer(token_budget=0)


class TestShouldCompact:
    def test_under_budget(self) -> None:
        obs = Observer(token_budget=999_999)
        msgs = (_user_msg("hi"),)
        assert obs.should_compact(msgs) is False

    def test_over_budget(self) -> None:
        obs = Observer(token_budget=1)
        msgs = (_user_msg("hi there, this is a message"),)
        assert obs.should_compact(msgs) is True

    def test_system_prompt_counted(self) -> None:
        obs = Observer(token_budget=50)
        msgs = (_user_msg("hi"),)
        # Without system prompt → under budget
        assert obs.should_compact(msgs) is False
        # With large system prompt → over budget
        assert obs.should_compact(msgs, system_prompt="x" * 400) is True


class TestCompact:
    @pytest.mark.asyncio
    async def test_single_message_unchanged(self) -> None:
        obs = Observer()
        msgs = (_user_msg("hi"),)
        result = await obs.compact(msgs)
        assert result == msgs

    @pytest.mark.asyncio
    async def test_preserves_first_message(self) -> None:
        obs = Observer(max_full_interactions=1)
        msgs = (
            _user_msg("original task"),
            _tool_use_msg("search"),
            _tool_result_msg("r" * 200),
            _tool_use_msg("code"),
            _tool_result_msg("r" * 200),
            _tool_use_msg("final"),
            _tool_result_msg("done"),
        )
        result = await obs.compact(msgs)
        assert result[0] == _user_msg("original task")

    @pytest.mark.asyncio
    async def test_hot_tier_kept_verbatim(self) -> None:
        obs = Observer(max_full_interactions=1)
        last_result = _tool_result_msg("final result content")
        msgs = (
            _user_msg("task"),
            _tool_use_msg("old_tool"),
            _tool_result_msg("x" * 200),
            _tool_use_msg("new_tool"),
            last_result,
        )
        result = await obs.compact(msgs)
        # The last tool result should be in the hot tier, verbatim
        assert last_result in result

    @pytest.mark.asyncio
    async def test_all_fit_in_hot_tier(self) -> None:
        obs = Observer(max_full_interactions=10)
        msgs = (
            _user_msg("task"),
            _tool_use_msg("tool1"),
            _tool_result_msg("result1"),
        )
        result = await obs.compact(msgs)
        assert result == msgs

    @pytest.mark.asyncio
    async def test_warm_tier_summarised_with_client(self) -> None:
        mock_client = AsyncMock()
        mock_client.create_message.return_value = AsyncMock(
            text="- Used search tool, found relevant docs\n- Ran code, got output X",
        )
        obs = Observer(
            max_full_interactions=1,
            claude_client=mock_client,
            summary_model="claude-haiku-4-5-20251001",
        )
        msgs = (
            _user_msg("task"),
            _tool_use_msg("search"),
            _tool_result_msg("x" * 200),
            _tool_use_msg("code"),
            _tool_result_msg("y" * 200),
            _tool_use_msg("final"),
            _tool_result_msg("done"),
        )
        result = await obs.compact(msgs)
        # Should have: first_msg, summary_msg, hot_tier_messages
        assert result[0] == _user_msg("task")
        assert "Previous work" in result[1]["content"]
        assert result[1]["role"] == "assistant"
        mock_client.create_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_fallback_on_llm_failure(self) -> None:
        mock_client = AsyncMock()
        mock_client.create_message.side_effect = RuntimeError("API down")
        obs = Observer(
            max_full_interactions=1,
            claude_client=mock_client,
            summary_model="claude-haiku-4-5-20251001",
        )
        msgs = (
            _user_msg("task"),
            _tool_use_msg("old_tool"),
            _tool_result_msg("x" * 200),
            _tool_use_msg("new_tool"),
            _tool_result_msg("done"),
        )
        # Should not raise — falls back to truncation
        result = await obs.compact(msgs)
        assert len(result) > 1
        assert result[0] == _user_msg("task")

    @pytest.mark.asyncio
    async def test_fallback_without_client(self) -> None:
        obs = Observer(max_full_interactions=1)
        msgs = (
            _user_msg("task"),
            _tool_use_msg("old_tool"),
            _tool_result_msg("x" * 200),
            _tool_use_msg("new_tool"),
            _tool_result_msg("done"),
        )
        result = await obs.compact(msgs)
        # Falls back to truncation (no client configured)
        assert result[0] == _user_msg("task")
        # Warm tier messages should be truncated, not summarised
        assert len(result) > 2

    @pytest.mark.asyncio
    async def test_screenshot_replaced_in_warm_tier(self) -> None:
        obs = Observer(max_full_interactions=1)
        msgs = (
            _user_msg("task"),
            _tool_use_msg("browser"),
            # Warm tier: image + tool result that will be compacted
            {
                "role": "user",
                "content": [
                    _image_block(),
                    {
                        "type": "tool_result",
                        "tool_use_id": "call_browser",
                        "content": "page loaded",
                    },
                ],
            },
            _tool_use_msg("final"),
            _tool_result_msg("done"),
        )
        result = await obs.compact(msgs)
        # The image block in the warm tier should have its source replaced
        found_compacted_image = False
        for msg in result:
            content = msg.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "image":
                        if block["source"] == "[screenshot captured]":
                            found_compacted_image = True
        assert found_compacted_image, (
            "Expected image block in warm tier to be compacted"
        )
