"""Tests for the context compaction observer."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from agent.context.compaction import (
    Observer,
    compaction_summary_for_persistence,
    _build_tool_use_map,
    _compact_content_block,
    _compute_full_boundary,
    _estimate_tokens,
    _find_tool_interaction_indices,
    _flatten_content,
    _summarize_tool_call,
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


@pytest.fixture(autouse=True)
def _default_weighted_token_strategy(monkeypatch) -> None:
    monkeypatch.setattr(
        "config.settings.get_settings",
        lambda: SimpleNamespace(
            COMPACT_TOKEN_COUNTER="weighted",
            COMPACT_FALLBACK_PREVIEW_CHARS=500,
            COMPACT_FALLBACK_RESULT_CHARS=1000,
            COMPACT_DIALOGUE_FALLBACK_CHARS=12_000,
        ),
    )


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

    def test_non_ascii_system_prompt_counts_more_than_ascii(self) -> None:
        ascii_prompt = "a" * 40
        cjk_prompt = "你" * 40

        assert _estimate_tokens((), system_prompt=cjk_prompt) > _estimate_tokens(
            (), system_prompt=ascii_prompt
        )

    def test_non_ascii_message_uses_weighted_estimate(self) -> None:
        tokens = _estimate_tokens((_user_msg("你" * 40),))

        # With 1.5x CJK weighting: 40 CJK chars * 1.5 = 60 + JSON overhead
        assert tokens == 68

    def test_cjk_weighting_applies_to_cjk_chars_only(self) -> None:
        """CJK chars use 1.5x weighting, other non-ASCII use 1.0x."""
        # CJK characters (Chinese)
        cjk_tokens = _estimate_tokens((_user_msg("你" * 40),))
        # Latin-1 supplement (non-CJK non-ASCII)
        latin_tokens = _estimate_tokens((_user_msg("é" * 40),))

        # CJK should have higher token count due to 1.5x weighting
        assert cjk_tokens > latin_tokens
        # Latin-1 should be: 40 chars * 1.0 + JSON overhead
        assert latin_tokens == 48

    def test_legacy_strategy_uses_less_unicode_weighting(self, monkeypatch) -> None:
        monkeypatch.setattr(
            "config.settings.get_settings",
            lambda: SimpleNamespace(COMPACT_TOKEN_COUNTER="legacy"),
        )
        legacy_tokens = _estimate_tokens((_user_msg("你" * 40),))

        monkeypatch.setattr(
            "config.settings.get_settings",
            lambda: SimpleNamespace(COMPACT_TOKEN_COUNTER="weighted"),
        )
        weighted_tokens = _estimate_tokens((_user_msg("你" * 40),))

        assert legacy_tokens < weighted_tokens

    def test_get_settings_errors_are_not_silenced(self, monkeypatch) -> None:
        def _raise() -> None:
            raise RuntimeError("settings broken")

        monkeypatch.setattr("config.settings.get_settings", _raise)

        with pytest.raises(RuntimeError, match="settings broken"):
            _estimate_tokens((_user_msg("hi"),))


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
        assert _compute_full_boundary((1, 3, 5, 7, 9, 11), max_full=3) == 6

    def test_includes_preceding_tool_use_message(self) -> None:
        assert _compute_full_boundary((1, 3), max_full=1) == 2


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

    def test_truncate_tool_result_uses_configured_preview_chars_with_tool_context(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(
            "config.settings.get_settings",
            lambda: SimpleNamespace(
                COMPACT_TOKEN_COUNTER="weighted",
                COMPACT_FALLBACK_PREVIEW_CHARS=12,
                COMPACT_FALLBACK_RESULT_CHARS=34,
            ),
        )
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": "x" * 200,
        }
        tool_use_map = {
            "call_1": {"name": "web_search", "input": {"query": "short query"}},
        }

        result = _truncate_tool_result(block, tool_use_map=tool_use_map)

        assert result["content"].split("] ", 1)[1] == "x" * 12

    def test_truncate_tool_result_uses_configured_result_chars_without_tool_context(
        self, monkeypatch
    ) -> None:
        monkeypatch.setattr(
            "config.settings.get_settings",
            lambda: SimpleNamespace(
                COMPACT_TOKEN_COUNTER="weighted",
                COMPACT_FALLBACK_PREVIEW_CHARS=12,
                COMPACT_FALLBACK_RESULT_CHARS=120,
            ),
        )
        block = {
            "type": "tool_result",
            "tool_use_id": "call_missing",
            "content": "x" * 500,
        }

        result = _truncate_tool_result(block, tool_use_map={})

        assert result["content"] == "x" * 120 + "...[HISTORY_TRUNCATED]"

    def test_truncate_tool_result_uses_history_marker_for_large_preview(self) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": "call_x",
            "content": "结果" * 800,
        }

        result = _truncate_tool_result(block, tool_use_map={})

        assert "[HISTORY_TRUNCATED]" in str(result["content"])

    def test_truncate_tool_result_keeps_larger_preview_without_tool_context(
        self,
    ) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": "call_x",
            "content": "x" * 1500,
        }

        result = _truncate_tool_result(block, tool_use_map={})

        assert result["content"].startswith("x" * 1000)
        assert result["content"].endswith("...[HISTORY_TRUNCATED]")

    def test_truncate_tool_result_does_not_grow_without_tool_context(self) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": "call_x",
            "content": "x" * 101,
        }

        result = _truncate_tool_result(block, tool_use_map={})

        assert result["content"] == "x" * 101

    def test_truncate_tool_result_does_not_grow_with_tool_summary(self) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": "x" * 101,
        }
        tool_use_map = {
            "call_1": {"name": "web_search", "input": {"query": "short query"}},
        }

        result = _truncate_tool_result(block, tool_use_map=tool_use_map)

        assert result["content"] == "x" * 101

    def test_long_string_truncated(self) -> None:
        block = {"type": "tool_result", "content": "x" * 1500}
        result = _truncate_tool_result(block)
        assert "[HISTORY_TRUNCATED]" in result["content"]
        assert len(result["content"]) < 1500

    def test_list_content_short_untouched(self) -> None:
        block = {"type": "tool_result", "content": [{"text": "short"}]}
        assert _truncate_tool_result(block) is block

    def test_list_content_long_truncated(self) -> None:
        block = {"type": "tool_result", "content": [{"text": "y" * 1500}]}
        result = _truncate_tool_result(block)
        assert "[HISTORY_TRUNCATED]" in result["content"]

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

    def test_rejects_zero_dialogue_turns(self) -> None:
        with pytest.raises(ValueError, match="max_full_dialogue_turns"):
            Observer(max_full_dialogue_turns=0)

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
        obs = Observer(max_full_interactions=1, token_budget=200)
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
        obs = Observer(max_full_interactions=1, token_budget=200)
        last_use = _tool_use_msg("new_tool")
        last_result = _tool_result_msg("final result content")
        msgs = (
            _user_msg("task"),
            _tool_use_msg("old_tool"),
            _tool_result_msg("x" * 200),
            last_use,
            last_result,
        )
        result = await obs.compact(msgs)
        # The last tool result should be in the hot tier, verbatim
        assert last_result in result
        assert last_use in result

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
        mock_client = MagicMock()
        mock_client.create_message = AsyncMock(
            return_value=SimpleNamespace(
                text="- Used search tool, found relevant docs\n- Ran code, got output X",
            ),
        )
        obs = Observer(
            max_full_interactions=1,
            token_budget=200,
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
            token_budget=200,
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
    async def test_compact_falls_back_to_structured_tool_summary_when_summariser_fails(
        self,
    ) -> None:
        client = AsyncMock()
        client.create_message.side_effect = RuntimeError("haiku unavailable")
        obs = Observer(
            max_full_interactions=1,
            token_budget=200,
            claude_client=client,
            summary_model="haiku",
        )
        msgs = (
            _user_msg("task"),
            _tool_use_msg("web_search", {"query": "上海天气"}),
            _tool_result_msg("晴天" * 100, tool_use_id="call_web_search"),
            _tool_use_msg("final"),
            _tool_result_msg("done", tool_use_id="call_final"),
        )

        compacted = await obs.compact(msgs)

        warm_block = compacted[1]["content"][0]
        client.create_message.assert_called_once()
        assert "web_search" in str(warm_block)
        assert "HISTORY_TRUNCATED" not in str(warm_block)

    @pytest.mark.asyncio
    async def test_compact_falls_back_to_larger_preview_without_tool_context(
        self,
    ) -> None:
        obs = Observer(max_full_interactions=1, token_budget=200)
        msgs = (
            _user_msg("task"),
            _tool_result_msg("x" * 1500, tool_use_id="call_missing"),
            _tool_use_msg("final"),
            _tool_result_msg("done", tool_use_id="call_final"),
        )

        compacted = await obs.compact(msgs)

        assert _estimate_tokens(compacted) <= 200
        warm_block = compacted[1]["content"][0]
        assert "HISTORY_TRUNCATED" in warm_block["content"]
        assert warm_block["content"].startswith("x") or warm_block[
            "content"
        ].startswith("...[HISTORY_TRUNCATED]")

    @pytest.mark.asyncio
    async def test_fallback_without_client(self) -> None:
        obs = Observer(max_full_interactions=1, token_budget=200)
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
        obs = Observer(max_full_interactions=1, token_budget=100)
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
        assert _estimate_tokens(result) <= 100
        if not found_compacted_image:
            assert any(
                msg.get("role") == "assistant"
                and isinstance(msg.get("content"), str)
                and msg["content"].startswith("## Previous work\n")
                for msg in result
            )

    @pytest.mark.asyncio
    async def test_tool_thread_compaction_converges_under_budget(self) -> None:
        obs = Observer(max_full_interactions=1, token_budget=220)
        msgs = (
            _user_msg("task"),
            _tool_use_msg("old_tool", {"query": "alpha"}),
            _tool_result_msg("x" * 5000, tool_use_id="call_old_tool"),
            _tool_use_msg("new_tool", {"query": "beta"}),
            _tool_result_msg("y" * 4000, tool_use_id="call_new_tool"),
        )

        result = await obs.compact(msgs)

        assert _estimate_tokens(result) <= 220
        assert result[0] == _user_msg("task")

    @pytest.mark.asyncio
    async def test_compact_can_shrink_oversized_anchor_message(self) -> None:
        obs = Observer(max_full_interactions=1, token_budget=220)
        msgs = (
            _user_msg("anchor " * 500),
            _tool_use_msg("old_tool", {"query": "alpha"}),
            _tool_result_msg("x" * 2000, tool_use_id="call_old_tool"),
            _tool_use_msg("new_tool", {"query": "beta"}),
            _tool_result_msg("done", tool_use_id="call_new_tool"),
        )

        result = await obs.compact(msgs)

        assert _estimate_tokens(result) <= 220
        assert result[0]["role"] == "user"
        assert "original task truncated" in str(result[0]["content"])


# ------------------------------------------------------------------
# Error preservation
# ------------------------------------------------------------------


class TestErrorPreservation:
    def test_error_result_never_truncated(self) -> None:
        """is_error=True tool results must be preserved verbatim."""
        long_error = "x" * 500
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": long_error,
            "is_error": True,
        }
        result = _truncate_tool_result(block)
        # Should be the exact same block — no truncation
        assert result is block

    def test_error_result_with_list_content_preserved(self) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": [{"type": "text", "text": "y" * 500}],
            "is_error": True,
        }
        result = _truncate_tool_result(block)
        assert result is block

    def test_successful_long_result_still_truncated(self) -> None:
        """Non-error results should still be truncated."""
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": "z" * 1500,
        }
        result = _truncate_tool_result(block)
        assert result is not block
        assert len(result["content"]) < 1500

    @pytest.mark.asyncio
    async def test_compact_preserves_errors_in_warm_tier(self) -> None:
        """Errors in the warm tier should survive compaction."""
        obs = Observer(max_full_interactions=1, token_budget=200)
        error_content = "ImportError: No module named 'foo'" + " details" * 50
        msgs = (
            _user_msg("task"),
            _tool_use_msg("code_run"),
            {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "call_code_run",
                        "content": error_content,
                        "is_error": True,
                    },
                ],
            },
            _tool_use_msg("final"),
            _tool_result_msg("done"),
        )
        result = await obs.compact(msgs)
        # Find the error block — it should be fully preserved
        for msg in result:
            content = msg.get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("is_error"):
                        assert block["content"] == error_content


# ------------------------------------------------------------------
# Dialogue compaction (DB / Telegram-style text threads)
# ------------------------------------------------------------------


class TestDialogueCompaction:
    @pytest.mark.asyncio
    async def test_pure_text_thread_summarised(self) -> None:
        mock_client = MagicMock()
        mock_client.create_message = AsyncMock(
            return_value=SimpleNamespace(
                text="- user asked about plans\n- assistant suggested Tuesday",
            ),
        )
        chunk = "hello " * 300
        pairs: list[dict[str, Any]] = []
        for i in range(12):
            pairs.append(_user_msg(f"u{i} {chunk}"))
            pairs.append(_assistant_msg(f"a{i} {chunk}"))
        msgs = (_user_msg("anchor task"), *pairs)
        obs = Observer(
            token_budget=2_000,
            max_full_dialogue_turns=2,
            claude_client=mock_client,
            summary_model="claude-haiku-test",
        )
        assert obs.should_compact(msgs, "")
        out = await obs.compact(msgs, "")
        assert len(out) < len(msgs)
        assert out[0] == msgs[0]
        assert "## Earlier conversation" in out[1]["content"]
        mock_client.create_message.assert_called()

    @pytest.mark.asyncio
    async def test_pure_text_truncation_without_llm(self) -> None:
        chunk = "z" * 400
        pairs: list[dict[str, Any]] = []
        for i in range(14):
            pairs.append(_user_msg(f"u{i}{chunk}"))
            pairs.append(_assistant_msg(f"a{i}{chunk}"))
        msgs = (_user_msg("anchor"), *pairs)
        obs = Observer(
            token_budget=900,
            max_full_dialogue_turns=2,
            claude_client=None,
            summary_model="",
        )
        out = await obs.compact(msgs, "")
        assert len(out) < len(msgs)
        assert "## Earlier conversation" in out[1]["content"]

    @pytest.mark.asyncio
    async def test_dialogue_compaction_can_shrink_oversized_anchor_message(
        self,
    ) -> None:
        chunk = "anchor " * 500
        msgs = (
            _user_msg(chunk),
            _assistant_msg("ack"),
            _user_msg("follow-up " * 100),
            _assistant_msg("response " * 100),
        )
        obs = Observer(
            token_budget=180,
            max_full_dialogue_turns=1,
            claude_client=None,
            summary_model="",
        )

        out = await obs.compact(msgs, "")

        assert _estimate_tokens(out) <= 180
        assert out[0]["role"] == "user"
        assert "original task truncated" in str(out[0]["content"])


class TestCompactionSummaryForPersistence:
    def test_extracts_dialogue_heading(self) -> None:
        m = (
            _user_msg("a"),
            {"role": "assistant", "content": "## Earlier conversation\nx"},
        )
        assert compaction_summary_for_persistence(m) == "## Earlier conversation\nx"

    def test_extracts_work_heading(self) -> None:
        m = (_user_msg("a"), {"role": "assistant", "content": "## Previous work\ny"})
        assert compaction_summary_for_persistence(m) == "## Previous work\ny"


# ------------------------------------------------------------------
# Tool use map
# ------------------------------------------------------------------


class TestBuildToolUseMap:
    def test_extracts_tool_uses(self) -> None:
        msgs = [
            _tool_use_msg("web_search", {"query": "AI agents"}),
            _tool_result_msg("results here", tool_use_id="call_web_search"),
        ]
        tmap = _build_tool_use_map(msgs)
        assert "call_web_search" in tmap
        assert tmap["call_web_search"]["name"] == "web_search"
        assert tmap["call_web_search"]["input"] == {"query": "AI agents"}

    def test_empty_messages(self) -> None:
        assert _build_tool_use_map([]) == {}

    def test_no_tool_uses(self) -> None:
        msgs = [_user_msg("hello"), _assistant_msg("hi")]
        assert _build_tool_use_map(msgs) == {}

    def test_multiple_tool_uses(self) -> None:
        msgs = [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "c1",
                        "name": "web_search",
                        "input": {"query": "foo"},
                    },
                    {
                        "type": "tool_use",
                        "id": "c2",
                        "name": "file_read",
                        "input": {"path": "/x"},
                    },
                ],
            },
        ]
        tmap = _build_tool_use_map(msgs)
        assert len(tmap) == 2
        assert tmap["c1"]["name"] == "web_search"
        assert tmap["c2"]["name"] == "file_read"


# ------------------------------------------------------------------
# Semantic tool summaries
# ------------------------------------------------------------------


class TestSummarizeToolCall:
    def test_web_search(self) -> None:
        result = _summarize_tool_call(
            "web_search",
            {"query": "AI agents"},
            "[]",
            is_error=False,
        )
        assert "web_search" in result
        assert "AI agents" in result
        assert "success" in result

    def test_error_result(self) -> None:
        result = _summarize_tool_call(
            "shell_exec",
            {"command": "npm test"},
            "",
            is_error=True,
        )
        assert "error" in result
        assert "npm test" in result

    def test_json_array_result_count(self) -> None:
        import json

        data = json.dumps([{"title": "a"}, {"title": "b"}, {"title": "c"}])
        result = _summarize_tool_call(
            "web_search",
            {"query": "test"},
            data,
            is_error=False,
        )
        assert "3 results" in result

    def test_no_key_param(self) -> None:
        result = _summarize_tool_call(
            "browser_view",
            {},
            "page content",
            is_error=False,
        )
        assert "browser_view" in result
        assert "success" in result

    def test_long_param_truncated(self) -> None:
        result = _summarize_tool_call(
            "file_write",
            {"path": "a" * 100},
            "",
            is_error=False,
        )
        # The path should be truncated to 60 chars
        assert len(result) < 150

    def test_truncate_uses_semantic_summary(self) -> None:
        """_truncate_tool_result should use semantic summary when map provided."""
        tool_use_map = {
            "call_1": {"name": "web_search", "input": {"query": "test query"}},
        }
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": "x" * 1500,
        }
        result = _truncate_tool_result(block, tool_use_map=tool_use_map)
        # Should contain the semantic summary, not raw truncation
        assert "web_search" in result["content"]
        assert "test query" in result["content"]

    def test_truncate_fallback_without_map(self) -> None:
        """Without a tool_use_map, should fall back to raw preview."""
        block = {
            "type": "tool_result",
            "tool_use_id": "call_1",
            "content": "x" * 1500,
        }
        result = _truncate_tool_result(block)
        assert "[HISTORY_TRUNCATED]" in result["content"]
