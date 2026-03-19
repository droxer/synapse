"""Data models for the Agent Skills spec (SKILL.md format)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType

_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9]*(-[a-z0-9]+)*$")
_NAME_MAX_LENGTH = 64


def validate_skill_name(name: str) -> bool:
    """Return True if *name* is a valid skill identifier."""
    return bool(name and len(name) <= _NAME_MAX_LENGTH and _NAME_PATTERN.match(name))


_EMPTY_METADATA: MappingProxyType[str, str] = MappingProxyType({})


@dataclass(frozen=True)
class SkillMetadata:
    """Immutable frontmatter metadata from a SKILL.md file."""

    name: str
    description: str  # Required — no default
    license: str = ""
    compatibility: str | None = None
    allowed_tools: tuple[str, ...] = ()
    dependencies: tuple[str, ...] = ()
    sandbox_template: str | None = None
    metadata: MappingProxyType[str, str] = field(
        default_factory=lambda: _EMPTY_METADATA
    )


@dataclass(frozen=True)
class SkillContent:
    """Immutable representation of a fully parsed SKILL.md file."""

    metadata: SkillMetadata
    instructions: str
    directory_path: Path
    source_type: str  # "bundled", "user", or "project"


@dataclass(frozen=True)
class SkillCatalogEntry:
    """Lightweight tier-1 entry for system prompt injection."""

    name: str
    description: str
