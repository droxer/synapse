"""Shared helpers for memory-aware system prompt assembly."""

from __future__ import annotations

from typing import Any

from agent.llm.client import PromptTextBlock, build_system_prompt_blocks
from agent.memory.safety import validate_memory_text
from agent.skills.loader import SkillRegistry
from config.settings import get_settings


def format_memory_prompt_section(
    memory_entries: list[dict[str, str]],
    *,
    settings: Any | None = None,
) -> str:
    """Format memory entries as a bounded system prompt section."""
    if not memory_entries:
        return ""
    effective_settings = settings or get_settings()
    entry_cap = getattr(effective_settings, "MEMORY_PROMPT_ENTRY_MAX_CHARS", 300)
    section_cap = getattr(effective_settings, "MEMORY_PROMPT_MAX_CHARS", 4000)
    lines = [
        "<personal_memory>",
        "The following are things you have previously remembered about this user. "
        "Use this context to personalise your responses. "
        "You can update or add new memories with the memory_store tool.",
    ]
    closing_tag = "</personal_memory>"
    truncated_marker = "...[truncated]"
    section_truncated_marker = "...[memory entries truncated]"

    if section_cap <= 0:
        return ""

    base_section = "\n".join([*lines, closing_tag])
    if len(base_section) > section_cap:
        return ""

    def _truncate_value(value: str) -> str:
        if entry_cap <= 0 or len(value) <= entry_cap:
            return value
        head_len = max(0, entry_cap - len(truncated_marker))
        return f"{value[:head_len]}{truncated_marker}"

    section_truncated = False
    for entry in memory_entries:
        ns = entry.get("namespace", "default")
        key = entry["key"]
        raw_value = entry["value"]
        if not (
            validate_memory_text(ns).accepted
            and validate_memory_text(key).accepted
            and validate_memory_text(raw_value).accepted
        ):
            continue
        value = _truncate_value(raw_value)
        line = f"- [{ns}] {key}: {value}" if ns != "default" else f"- {key}: {value}"

        candidate_lines = [*lines, line, closing_tag]
        if len("\n".join(candidate_lines)) > section_cap:
            section_truncated = True
            break
        lines.append(line)

    if section_truncated:
        candidate_lines = [*lines, section_truncated_marker, closing_tag]
        if len("\n".join(candidate_lines)) <= section_cap:
            lines.append(section_truncated_marker)
        else:
            while lines:
                candidate_lines = [*lines, section_truncated_marker, closing_tag]
                if len("\n".join(candidate_lines)) <= section_cap:
                    lines.append(section_truncated_marker)
                    break
                lines.pop()
            else:
                return ""

    lines.append(closing_tag)
    return "\n" + "\n".join(lines)


def build_memory_aware_system_prompt_sections(
    base_prompt: str,
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
    *,
    settings: Any | None = None,
) -> tuple[PromptTextBlock, ...]:
    """Assemble system prompt sections with optional skill catalog and memory."""
    effective_settings = settings or get_settings()
    sections: list[str | PromptTextBlock] = [base_prompt]
    if skill_registry is not None and getattr(
        effective_settings, "SKILLS_ENABLED", True
    ):
        catalog_section = skill_registry.catalog_prompt_section()
        if catalog_section:
            sections.append(catalog_section)
    memory_section = format_memory_prompt_section(
        memory_entries or [],
        settings=effective_settings,
    )
    if memory_section:
        sections.append(memory_section)
    return build_system_prompt_blocks(*sections)
