"""Tests for the shared skill selector (agent.runtime.skill_selector)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from agent.llm.client import AnthropicClient, LLMResponse, TokenUsage
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent, SkillMetadata
from agent.runtime.skill_selector import AttachmentDescriptor


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_skill(
    name: str,
    description: str = "Default description for testing",
) -> SkillContent:
    return SkillContent(
        metadata=SkillMetadata(name=name, description=description),
        instructions=f"# {name} instructions",
        directory_path=Path(f"/tmp/{name}"),
        source_type="bundled",
    )


def _make_llm_response(text: str) -> LLMResponse:
    """Build a minimal LLMResponse with the given text content."""
    return LLMResponse(
        text=text,
        tool_calls=(),
        stop_reason="end_turn",
        usage=TokenUsage(input_tokens=10, output_tokens=5),
    )


def _mock_client(response_text: str) -> AnthropicClient:
    """Return a mock AnthropicClient whose create_message returns *response_text*."""
    client = AsyncMock(spec=AnthropicClient)
    client.create_message.return_value = _make_llm_response(response_text)
    return client


# ---------------------------------------------------------------------------
# Priority: explicit > model-driven > keyword fallback > none
# ---------------------------------------------------------------------------


class TestExplicitSkillSelection:
    """When the user has explicitly selected a skill, it wins without an LLM call."""

    @pytest.mark.asyncio
    async def test_explicit_skill_wins_without_llm_call(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        web = _make_skill("web-research", "Deep web research")
        data = _make_skill("data-analysis", "Analyze datasets")
        registry = SkillRegistry((web, data))
        client = _mock_client('{"skill": "data-analysis"}')

        result = await select_skill_for_message(
            user_message="research the web",
            selected_skills=("web-research",),
            attachment_descriptors=(
                AttachmentDescriptor(filename="report.csv", content_type="text/csv"),
            ),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "web-research"
        # No LLM call should have been made
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_explicit_skill_not_found_returns_none(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry((_make_skill("alpha"),))
        client = _mock_client('{"skill": null}')

        result = await select_skill_for_message(
            user_message="anything",
            selected_skills=("nonexistent-skill",),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_selected_skills_falls_through(self) -> None:
        """Empty selected_skills tuple should fall through to model-driven."""
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("web-research", "Deep web research methodology")
        registry = SkillRegistry((skill,))
        client = _mock_client(json.dumps({"skill": "web-research"}))

        await select_skill_for_message(
            user_message="do some research",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        # Should have attempted an LLM call since no explicit selection
        client.create_message.assert_called_once()


# ---------------------------------------------------------------------------
# Model-driven selection
# ---------------------------------------------------------------------------


class TestModelDrivenSelection:
    """When no explicit skill is selected, the LLM chooses."""

    @pytest.mark.asyncio
    async def test_model_picks_valid_skill(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        web = _make_skill("web-research", "Deep web research")
        data = _make_skill("data-analysis", "Analyze datasets")
        registry = SkillRegistry((web, data))
        client = _mock_client(json.dumps({"skill": "data-analysis"}))

        result = await select_skill_for_message(
            user_message="analyze this CSV",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"

    @pytest.mark.asyncio
    async def test_model_json_inside_markdown_fence(self) -> None:
        """Providers may wrap the object in ```json fences despite the prompt."""
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("web-research", "Deep web research")
        registry = SkillRegistry((skill,))
        client = _mock_client('```json\n{"skill": "web-research"}\n```')

        result = await select_skill_for_message(
            user_message="research this",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "web-research"

    @pytest.mark.asyncio
    async def test_model_json_after_leading_prose(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("data-analysis", "Analyze datasets")
        registry = SkillRegistry((skill,))
        client = _mock_client('Sure. {"skill": "data-analysis"}')

        result = await select_skill_for_message(
            user_message="analyze my sheet",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"

    @pytest.mark.asyncio
    async def test_model_returns_null_means_no_skill(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry((_make_skill("web-research", "web research"),))
        client = _mock_client(json.dumps({"skill": None}))

        result = await select_skill_for_message(
            user_message="what is 2+2",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None


# ---------------------------------------------------------------------------
# Fallback: invalid LLM output -> keyword match
# ---------------------------------------------------------------------------


class TestFallbackToKeyword:
    """If the LLM returns an invalid or nonexistent skill name, fall back to keyword matching."""

    @pytest.mark.asyncio
    async def test_invalid_selector_output_falls_back_to_keyword_match(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill(
            "web-research",
            "Deep web research with multi-query triangulation and source credibility",
        )
        registry = SkillRegistry((skill,))
        # LLM returns a name that doesn't exist in registry
        client = _mock_client(json.dumps({"skill": "nonexistent-skill"}))

        result = await select_skill_for_message(
            user_message="please research this topic with web sources",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        # Should fall back to keyword matching which would match "web-research"
        assert result is not None
        assert result.metadata.name == "web-research"

    @pytest.mark.asyncio
    async def test_malformed_json_falls_back_to_keyword_match(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill(
            "data-analysis",
            "analyze datasets charts statistics research",
        )
        registry = SkillRegistry((skill,))
        # LLM returns garbage
        client = _mock_client("this is not valid JSON at all")

        result = await select_skill_for_message(
            user_message="analyze these datasets with charts",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"

    @pytest.mark.asyncio
    async def test_llm_exception_falls_back_to_keyword_match(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill(
            "web-research",
            "Deep web research with multi-query triangulation and source credibility",
        )
        registry = SkillRegistry((skill,))
        client = AsyncMock(spec=AnthropicClient)
        client.create_message.side_effect = RuntimeError("API down")

        result = await select_skill_for_message(
            user_message="please research this topic with web sources",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "web-research"

    @pytest.mark.asyncio
    async def test_keyword_fallback_no_match_returns_none(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("web-research", "Deep web research with triangulation")
        registry = SkillRegistry((skill,))
        client = _mock_client("not json")

        result = await select_skill_for_message(
            user_message="hello world",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None


# ---------------------------------------------------------------------------
# JSON parsing helpers
# ---------------------------------------------------------------------------


class TestParseSkillSelectorJson:
    """Unit tests for tolerant parsing of model output."""

    def test_strips_bom_and_parses(self) -> None:
        from agent.runtime.skill_selector import _parse_skill_selector_json

        assert _parse_skill_selector_json('\ufeff{"skill": null}') == {"skill": None}

    def test_extracts_object_from_wrapped_text(self) -> None:
        from agent.runtime.skill_selector import _parse_skill_selector_json

        raw = '```\n{"skill": "alpha"}\n```'
        assert _parse_skill_selector_json(raw) == {"skill": "alpha"}

    def test_non_dict_top_level_returns_none(self) -> None:
        from agent.runtime.skill_selector import _parse_skill_selector_json

        assert _parse_skill_selector_json('["skill"]') is None


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    @pytest.mark.asyncio
    async def test_none_registry_returns_none(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        client = _mock_client('{"skill": null}')

        result = await select_skill_for_message(
            user_message="anything",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=None,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_registry_returns_none(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry(())
        client = _mock_client('{"skill": null}')

        result = await select_skill_for_message(
            user_message="anything",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_whitespace_only_selected_skill_ignored(self) -> None:
        """A selected_skills entry that is blank should be treated as no selection."""
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("web-research", "Deep web research methodology")
        registry = SkillRegistry((skill,))
        client = _mock_client(json.dumps({"skill": "web-research"}))

        await select_skill_for_message(
            user_message="research something",
            selected_skills=("  ",),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        # The whitespace-only entry should be ignored, falling through to model
        client.create_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_selector_prompt_includes_catalog(self) -> None:
        """The LLM call should include the skill catalog in the system prompt."""
        from agent.runtime.skill_selector import select_skill_for_message

        skill = _make_skill("web-research", "Deep web research")
        registry = SkillRegistry((skill,))
        client = _mock_client(json.dumps({"skill": "web-research"}))

        await select_skill_for_message(
            user_message="research something",
            selected_skills=(),
            attachment_descriptors=(),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        call_args = client.create_message.call_args
        system_prompt = call_args.kwargs.get("system") or call_args[1].get("system", "")
        assert "web-research" in system_prompt
        assert "Deep web research" in system_prompt


class TestAttachmentAwareSelection:
    @pytest.mark.asyncio
    async def test_generic_analysis_with_csv_attachment_selects_data_analysis(
        self,
    ) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry(
            (
                _make_skill(
                    "data-analysis", "Analyze datasets charts CSV spreadsheet files"
                ),
            )
        )
        client = _mock_client(json.dumps({"skill": None}))

        result = await select_skill_for_message(
            user_message="analyze this file",
            selected_skills=(),
            attachment_descriptors=(
                AttachmentDescriptor(filename="report.csv", content_type="text/csv"),
            ),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_spreadsheet_attachment_variants_select_data_analysis(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry(
            (
                _make_skill(
                    "data-analysis", "Analyze datasets charts CSV spreadsheet files"
                ),
            )
        )
        client = _mock_client(json.dumps({"skill": None}))

        result = await select_skill_for_message(
            user_message="please visualize this data",
            selected_skills=(),
            attachment_descriptors=(
                AttachmentDescriptor(
                    filename="budget.xlsx",
                    content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ),
            ),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"
        client.create_message.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_data_attachment_does_not_force_data_analysis(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry(
            (
                _make_skill(
                    "data-analysis", "Analyze datasets charts CSV spreadsheet files"
                ),
                _make_skill("web-research", "Deep web research"),
            )
        )
        client = _mock_client(json.dumps({"skill": None}))

        result = await select_skill_for_message(
            user_message="analyze this file",
            selected_skills=(),
            attachment_descriptors=(
                AttachmentDescriptor(filename="photo.png", content_type="image/png"),
            ),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is None
        client.create_message.assert_called_once()

    @pytest.mark.asyncio
    async def test_malformed_attachment_metadata_does_not_break_selection(self) -> None:
        from agent.runtime.skill_selector import select_skill_for_message

        registry = SkillRegistry(
            (
                _make_skill(
                    "data-analysis", "Analyze datasets charts CSV spreadsheet files"
                ),
            )
        )
        client = _mock_client("not json")

        result = await select_skill_for_message(
            user_message="analyze datasets with charts",
            selected_skills=(),
            attachment_descriptors=(
                AttachmentDescriptor(filename=" ", content_type=" "),
            ),
            skill_registry=registry,
            client=client,
            model="claude-haiku-4-5-20251001",
        )

        assert result is not None
        assert result.metadata.name == "data-analysis"
