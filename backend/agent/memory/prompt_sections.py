"""Prompt formatting helpers for memory-derived context."""

from __future__ import annotations

from agent.memory.safety import validate_memory_text


def format_verified_facts_prompt_section(
    facts: list[dict[str, str]],
    token_cap_chars: int,
) -> str:
    """Format verified fact records into a bounded prompt section."""
    if not facts or token_cap_chars <= 0:
        return ""

    lines = ["<verified_user_facts>", "Known user facts (verified):"]
    closing_tag = "</verified_user_facts>"
    minimum_section = "\n".join([*lines, closing_tag])
    if len(minimum_section) > token_cap_chars:
        return ""

    for fact in facts:
        ns = fact.get("namespace", "default")
        key = fact.get("key", "")
        value = fact.get("value", "")
        if not key or not value:
            continue
        if not (
            validate_memory_text(ns).accepted
            and validate_memory_text(key).accepted
            and validate_memory_text(value).accepted
        ):
            continue
        line = f"- [{ns}] {key}: {value}"
        candidate_lines = [*lines, line, closing_tag]
        if len("\n".join(candidate_lines)) > token_cap_chars:
            break
        lines.append(line)

    lines.append(closing_tag)
    return "\n".join(lines)
