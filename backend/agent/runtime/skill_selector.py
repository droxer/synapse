"""Shared skill selector — centralises explicit / model / keyword fallback logic."""

from __future__ import annotations

import json

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent

SELECTOR_SYSTEM_PROMPT = """Choose at most one skill from the provided catalog.
Return JSON: {"skill": "<name>"} or {"skill": null}."""


async def select_skill_for_message(
    *,
    user_message: str,
    selected_skills: tuple[str, ...],
    skill_registry: SkillRegistry | None,
    client: AnthropicClient,
    model: str,
) -> SkillContent | None:
    """Select a skill for *user_message* using a three-tier priority.

    Priority:
        1. **Explicit** — first non-blank entry in *selected_skills* looked up
           by name.  Returns ``None`` (not found) without touching the LLM.
        2. **Model-driven** — ask the LLM to pick a skill from the catalog.
        3. **Keyword fallback** — ``SkillRegistry.match_description()`` used
           when the LLM returns an invalid / unknown name or errors out.

    Returns the matched :class:`SkillContent` or ``None``.
    """
    # Short-circuit when there is nothing to match against
    if skill_registry is None or not skill_registry.catalog():
        return None

    # ---- tier 1: explicit user selection -----------------------------------
    explicit_name = next(
        (name for name in selected_skills if name.strip()),
        None,
    )
    if explicit_name is not None:
        found = skill_registry.find_by_name(explicit_name)
        if found is not None:
            logger.info("skill_selector_explicit name={}", explicit_name)
        else:
            logger.warning("skill_selector_explicit_not_found name={}", explicit_name)
        return found  # None when the explicit name doesn't exist

    # ---- tier 2: model-driven selection ------------------------------------
    catalog = skill_registry.catalog()
    catalog_lines = "\n".join(
        f"- {entry.name}: {entry.description}" for entry in catalog
    )
    system = f"{SELECTOR_SYSTEM_PROMPT}\n\nSkill catalog:\n{catalog_lines}"

    model_skill: SkillContent | None = None
    try:
        response = await client.create_message(
            system=system,
            messages=[{"role": "user", "content": user_message}],
            model=model,
            max_tokens=128,
        )
        parsed = json.loads(response.text)
        chosen_name = parsed.get("skill")
        if chosen_name is not None:
            model_skill = skill_registry.find_by_name(chosen_name)
            if model_skill is not None:
                logger.info("skill_selector_model name={}", chosen_name)
                return model_skill
            logger.warning(
                "skill_selector_model_unknown name={}, falling back to keyword",
                chosen_name,
            )
        else:
            logger.info("skill_selector_model chose no skill")
            return None
    except Exception as exc:
        logger.warning(
            "skill_selector_model_error error={}, falling back to keyword", exc
        )

    # ---- tier 3: keyword fallback ------------------------------------------
    fallback = skill_registry.match_description(user_message)
    if fallback is not None:
        logger.info("skill_selector_keyword_fallback name={}", fallback.metadata.name)
    return fallback
