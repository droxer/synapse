"""Tests for extended thinking support."""

from __future__ import annotations

from agent.llm.client import LLMResponse, TokenUsage, _extract_thinking, _parse_response


class TestLLMResponseThinking:
    def test_default_empty_thinking(self) -> None:
        r = LLMResponse(
            text="hello",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=10, output_tokens=5),
        )
        assert r.thinking == ""

    def test_with_thinking(self) -> None:
        r = LLMResponse(
            text="hello",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=10, output_tokens=5),
            thinking="Let me think...",
        )
        assert r.thinking == "Let me think..."

    def test_frozen(self) -> None:
        r = LLMResponse(
            text="hi",
            tool_calls=(),
            stop_reason="end_turn",
            usage=TokenUsage(input_tokens=1, output_tokens=1),
            thinking="thought",
        )
        import dataclasses

        assert dataclasses.is_dataclass(r)
        # Verify frozen
        try:
            r.thinking = "new"  # type: ignore[misc]
            assert False, "Should have raised"
        except AttributeError:
            pass


class TestExtractThinking:
    def test_empty_content(self) -> None:
        assert _extract_thinking([]) == ""

    def test_no_thinking_blocks(self) -> None:
        class TextBlock:
            type = "text"
            text = "hello"

        assert _extract_thinking([TextBlock()]) == ""

    def test_with_thinking_block(self) -> None:
        class ThinkingBlock:
            type = "thinking"
            thinking = "Let me reason..."

        assert _extract_thinking([ThinkingBlock()]) == "Let me reason..."

    def test_multiple_thinking_blocks(self) -> None:
        class ThinkingBlock:
            type = "thinking"

            def __init__(self, text: str) -> None:
                self.thinking = text

        blocks = [ThinkingBlock("First."), ThinkingBlock(" Second.")]
        assert _extract_thinking(blocks) == "First. Second."


class TestParseResponseThinking:
    def test_uses_explicit_thinking_block_only(self) -> None:
        class TextBlock:
            type = "text"
            text = "Visible answer"

        class ThinkingBlock:
            type = "thinking"
            thinking = "Hidden reasoning"

        class Usage:
            input_tokens = 10
            output_tokens = 5

        class Response:
            content = [TextBlock(), ThinkingBlock()]
            stop_reason = "end_turn"
            usage = Usage()

        parsed = _parse_response(Response())
        assert parsed.text == "Visible answer"
        assert parsed.thinking == "Hidden reasoning"

    def test_ignores_generic_reasoning_blocks(self) -> None:
        class TextBlock:
            type = "text"
            text = "Deep research summary"

        class ReasoningBlock:
            type = "reasoning"
            text = "Step-by-step hidden notes"

        class Usage:
            input_tokens = 10
            output_tokens = 5

        class Response:
            content = [TextBlock(), ReasoningBlock()]
            stop_reason = "end_turn"
            usage = Usage()

        parsed = _parse_response(Response())
        assert parsed.text == "Deep research summary"
        assert parsed.thinking == ""

    def test_ignores_top_level_reasoning_content_fallback(self) -> None:
        class TextBlock:
            type = "text"
            text = "Final user-facing answer"

        class Usage:
            input_tokens = 10
            output_tokens = 5

        class Response:
            content = [TextBlock()]
            stop_reason = "end_turn"
            usage = Usage()
            reasoning_content = "provider side reasoning"

        parsed = _parse_response(Response())
        assert parsed.text == "Final user-facing answer"
        assert parsed.thinking == ""

    def test_does_not_extract_inline_think_tags_into_thinking(self) -> None:
        class TextBlock:
            type = "text"
            text = "<think>internal notes</think>Visible answer"

        class Usage:
            input_tokens = 10
            output_tokens = 5

        class Response:
            content = [TextBlock()]
            stop_reason = "end_turn"
            usage = Usage()

        parsed = _parse_response(Response())
        assert parsed.text == "<think>internal notes</think>Visible answer"
        assert parsed.thinking == ""
