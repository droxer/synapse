"""Skill discovery — scans filesystem paths for SKILL.md files."""

from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

from loguru import logger

from agent.skills.models import SkillContent
from agent.skills.parser import parse_skill_md

_SKIP_DIRS = frozenset({".git", "node_modules", "__pycache__", ".venv", "venv"})
_MAX_DEPTH = 4
_SKILL_FILENAME = "SKILL.md"


class SkillDiscoverer:
    """Scans ordered filesystem paths for SKILL.md files.

    Path priority (first found wins):
    1. {project}/.synapse/skills/   (project, client-specific)
    2. {project}/.agents/skills/    (project, cross-client)
    3. ~/.synapse/skills/           (user, client-specific)
    4. ~/.agents/skills/            (user, cross-client)
    5. {bundled_dir}                (system)
    """

    def __init__(
        self,
        project_dir: str | None = None,
        bundled_dir: str | None = None,
        trust_project: bool = True,
    ) -> None:
        self._search_paths = _build_search_paths(
            project_dir, bundled_dir, trust_project
        )

    def discover_all(self) -> tuple[SkillContent, ...]:
        """Scan all search paths and return discovered skills."""
        seen_names: set[str] = set()
        skills: list[SkillContent] = []

        for search_path, source_type in self._search_paths:
            if not os.path.isdir(search_path):
                continue

            for skill in _scan_directory(search_path):
                name = skill.metadata.name
                if name in seen_names:
                    logger.warning(
                        "Skill '{}' shadowed — skipping duplicate from {}",
                        name,
                        skill.directory_path,
                    )
                    continue
                seen_names.add(name)
                skills.append(replace(skill, source_type=source_type))

        logger.info(
            "Discovered {} skills from {} search paths",
            len(skills),
            len(self._search_paths),
        )
        return tuple(skills)


def _build_search_paths(
    project_dir: str | None,
    bundled_dir: str | None,
    trust_project: bool,
) -> tuple[tuple[str, str], ...]:
    """Build the ordered list of (directory, source_type) to scan."""
    paths: list[tuple[str, str]] = []
    home = str(Path.home())

    if project_dir:
        if trust_project:
            paths.append((os.path.join(project_dir, ".synapse", "skills"), "project"))
            paths.append((os.path.join(project_dir, ".agents", "skills"), "project"))
        else:
            logger.warning(
                "SKILLS_TRUST_PROJECT=False — skipping project-level skills from {}",
                project_dir,
            )

    paths.append((os.path.join(home, ".synapse", "skills"), "user"))
    paths.append((os.path.join(home, ".agents", "skills"), "user"))

    if bundled_dir:
        paths.append((bundled_dir, "bundled"))
    else:
        paths.append((os.path.join(os.path.dirname(__file__), "bundled"), "bundled"))

    return tuple(paths)


def _scan_directory(root: str, depth: int = 0) -> list[SkillContent]:
    """Recursively scan *root* for SKILL.md files up to _MAX_DEPTH."""
    results: list[SkillContent] = []

    if depth > _MAX_DEPTH:
        return results

    try:
        entries = sorted(os.listdir(root))
    except PermissionError:
        logger.warning("Permission denied scanning: {}", root)
        return results

    for entry in entries:
        full_path = os.path.join(root, entry)

        if entry == _SKILL_FILENAME and os.path.isfile(full_path):
            try:
                skill = parse_skill_md(full_path)
                results.append(skill)
            except Exception as exc:
                logger.error("Failed to parse {}: {}", full_path, exc)
            continue

        if os.path.isdir(full_path) and entry not in _SKIP_DIRS:
            results.extend(_scan_directory(full_path, depth + 1))

    return results
