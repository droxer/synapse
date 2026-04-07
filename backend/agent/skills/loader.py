"""Skill registry — queryable, immutable collection of discovered skills."""

from __future__ import annotations

import re

from loguru import logger

from agent.skills.models import SkillCatalogEntry, SkillContent

_STOP_WORDS = frozenset(
    {
        "a",
        "an",
        "the",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "being",
        "have",
        "has",
        "had",
        "do",
        "does",
        "did",
        "will",
        "would",
        "could",
        "should",
        "may",
        "might",
        "shall",
        "can",
        "for",
        "of",
        "to",
        "in",
        "on",
        "at",
        "by",
        "with",
        "from",
        "and",
        "or",
        "but",
        "not",
        "this",
        "that",
        "it",
        "as",
        "if",
        "when",
    }
)

_MATCH_THRESHOLD = 2

_WORD_RE = re.compile(r"\w+")


def _tokenize(text: str) -> set[str]:
    """Tokenize text into lowercase words, excluding stop words."""
    return {w for w in _WORD_RE.findall(text.lower()) if w not in _STOP_WORDS}


def _contains_skill_name(text: str, skill_name: str) -> bool:
    """Return True when the exact skill name appears in user text."""
    pattern = re.compile(rf"(?<!\w){re.escape(skill_name.lower())}(?!\w)")
    return pattern.search(text.lower()) is not None


class SkillRegistry:
    """Immutable-style registry of loaded skills (SKILL.md format)."""

    def __init__(self, skills: tuple[SkillContent, ...] = ()) -> None:
        self._skills = skills
        self._by_name: dict[str, SkillContent] = {s.metadata.name: s for s in skills}

    def find_by_name(self, name: str) -> SkillContent | None:
        return self._by_name.get(name)

    def catalog(self) -> tuple[SkillCatalogEntry, ...]:
        return tuple(
            SkillCatalogEntry(
                name=s.metadata.name,
                description=s.metadata.description,
            )
            for s in self._skills
        )

    def match_description(self, text: str) -> SkillContent | None:
        """Match user text against skill descriptions and return the best match.

        Uses keyword overlap (excluding stop words). Returns the skill with
        the most matching words, or None if below threshold. Ties broken
        by insertion order (first registered wins).
        """
        if not text:
            return None

        normalized_text = text.lower()
        user_words = _tokenize(text)
        if not user_words:
            return None

        best_skill: SkillContent | None = None
        best_score = (0, 0, 0)

        for skill in self._skills:
            name_words = _tokenize(skill.metadata.name.replace("-", " "))
            desc_words = _tokenize(skill.metadata.description)
            score = (
                1 if _contains_skill_name(normalized_text, skill.metadata.name) else 0,
                len(user_words & name_words),
                len(user_words & desc_words),
            )
            if score > best_score:
                best_score = score
                best_skill = skill

        if best_skill is None:
            return None

        exact_name_match, name_overlap, desc_overlap = best_score
        if exact_name_match:
            return best_skill
        if (
            len(_tokenize(best_skill.metadata.name.replace("-", " "))) > 1
            and name_overlap >= 2
        ):
            return best_skill
        if desc_overlap < _MATCH_THRESHOLD:
            return None

        return best_skill

    def catalog_prompt_section(self) -> str:
        """Format the skill catalog as XML for system prompt injection."""
        if not self._skills:
            return ""

        import html as _html

        lines = [
            "\n<available_skills>",
            "When a task matches a skill's description, call the activate_skill tool",
            "with the skill's name to load its full instructions.",
            "",
        ]
        for skill in self._skills:
            meta = skill.metadata
            lines.append("<skill>")
            lines.append(f"  <name>{_html.escape(meta.name)}</name>")
            lines.append(
                f"  <description>{_html.escape(meta.description)}</description>"
            )
            lines.append("</skill>")

        lines.append("</available_skills>")
        return "\n".join(lines)

    def all_skills(self) -> tuple[SkillContent, ...]:
        return self._skills

    def names(self) -> tuple[str, ...]:
        return tuple(self._by_name.keys())

    def add_skill(self, skill: SkillContent) -> SkillRegistry:
        """Return a new registry with the given skill added."""
        name = skill.metadata.name
        if name in self._by_name:
            logger.warning("Skill '{}' already registered, replacing", name)
            filtered = tuple(s for s in self._skills if s.metadata.name != name)
            return SkillRegistry((*filtered, skill))
        return SkillRegistry((*self._skills, skill))

    def remove_skill(self, name: str) -> SkillRegistry:
        """Return a new registry without the named skill."""
        filtered = tuple(s for s in self._skills if s.metadata.name != name)
        return SkillRegistry(filtered)

    def filter_by_names(self, allowed_names: set[str]) -> SkillRegistry:
        """Return a new registry containing only skills whose names are in *allowed_names*."""
        filtered = tuple(s for s in self._skills if s.metadata.name in allowed_names)
        return SkillRegistry(filtered)
