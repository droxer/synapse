"""Helpers for building user-scoped skill views."""

from __future__ import annotations

import uuid
from dataclasses import replace
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from loguru import logger

from agent.skills.loader import SkillRegistry
from agent.skills.parser import parse_skill_md
from api.dependencies import AppState

_SHARED_SOURCE_TYPES = frozenset({"bundled", "project"})


async def build_user_skill_registry(
    state: AppState,
    user_id: uuid.UUID | None,
    *,
    include_disabled: bool = False,
) -> SkillRegistry | None:
    """Return a registry containing only skills visible to *user_id*."""
    global_registry = getattr(state, "skill_registry", None)
    if global_registry is None:
        return None

    skill_repo = getattr(state, "skill_repo", None)
    if skill_repo is None:
        return global_registry

    async with state.db_session_factory() as session:
        db_records = await skill_repo.list_skills(session, user_id=user_id)

    if not db_records:
        shared = tuple(
            skill
            for skill in global_registry.all_skills()
            if skill.source_type in _SHARED_SOURCE_TYPES
        )
        return SkillRegistry(shared)

    visible_records = {
        record.name: record
        for record in db_records
        if include_disabled or record.enabled
    }
    scoped = SkillRegistry(
        tuple(
            skill
            for skill in global_registry.all_skills()
            if skill.source_type in _SHARED_SOURCE_TYPES
            and skill.metadata.name in visible_records
        )
    )

    for record in visible_records.values():
        if record.source_type in _SHARED_SOURCE_TYPES:
            continue
        skill_file = Path(record.source_path) / "SKILL.md"
        try:
            skill = parse_skill_md(str(skill_file))
        except Exception as exc:
            logger.warning(
                "user_skill_load_failed name={} path={} error={}",
                record.name,
                skill_file,
                exc,
            )
            continue
        scoped = scoped.add_skill(replace(skill, source_type=record.source_type))

    return scoped


async def visible_skill_or_404(
    state: AppState,
    *,
    name: str,
    user_id: uuid.UUID | None,
    include_disabled: bool = True,
) -> Any:
    """Return a visible skill or raise a 404."""
    registry = await build_user_skill_registry(
        state,
        user_id,
        include_disabled=include_disabled,
    )
    if registry is None:
        raise HTTPException(status_code=503, detail="Skills system not initialized")
    skill = registry.find_by_name(name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found")
    return skill
