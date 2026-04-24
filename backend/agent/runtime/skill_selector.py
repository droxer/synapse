"""Shared skill selector — centralises explicit / model / keyword fallback logic."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from loguru import logger

from agent.llm.client import AnthropicClient
from agent.skills.loader import SkillRegistry
from agent.skills.models import SkillContent

SELECTOR_SYSTEM_PROMPT = """Choose at most one skill from the provided catalog.
Return JSON: {"skill": "<name>"} or {"skill": null}."""

_ANALYSIS_INTENT_RE = re.compile(
    r"\b("
    r"analy[sz]e|analysis|chart|charts|graph|graphs|plot|plots|visuali[sz]e|"
    r"statistics|stats|dataset|datasets|data|table|tables|spreadsheet|spreadsheets"
    r")\b",
    re.IGNORECASE,
)
_SKILL_MODEL_PROBE_RE = re.compile(
    r"\b("
    r"analy[sz]e|research|chart|plot|visuali[sz]e|review|audit|refactor|"
    r"simplif(?:y|ication)|optimi[sz]e|improv(?:e|ement)|debug|fix|"
    r"build|design|create|generate|install"
    r")\b",
    re.IGNORECASE,
)
_DATA_FILE_SUFFIXES = (
    ".csv",
    ".tsv",
    ".xlsx",
    ".xls",
    ".json",
    ".jsonl",
    ".parquet",
)
_DATA_MIME_MARKERS = (
    "text/csv",
    "text/tab-separated-values",
    "application/csv",
    "application/json",
    "application/parquet",
    "spreadsheet",
    "excel",
)


@dataclass(frozen=True)
class AttachmentDescriptor:
    """Lightweight attachment metadata used for skill routing."""

    filename: str
    content_type: str


def _first_balanced_json_object(text: str) -> str | None:
    """Return the first top-level `{ ... }` slice in *text*, or ``None``.

    Hosts sometimes return prose, markdown fences, or BOM-prefixed text before
    the JSON object.  A simple brace depth walk is enough for flat selector
    payloads (`{"skill": ...}`).
    """
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _parse_skill_selector_json(raw: str) -> dict | None:
    """Parse selector JSON from model text; tolerate wrappers and extra prose."""
    text = raw.strip().removeprefix("\ufeff")
    if not text:
        return None
    try:
        val = json.loads(text)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass
    snippet = _first_balanced_json_object(text)
    if snippet is None:
        return None
    try:
        val = json.loads(snippet)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        return None
    return None


def _normalize_attachment_descriptors(
    attachment_descriptors: tuple[AttachmentDescriptor, ...],
) -> tuple[AttachmentDescriptor, ...]:
    normalized: list[AttachmentDescriptor] = []
    for descriptor in attachment_descriptors:
        filename = descriptor.filename.strip()
        content_type = descriptor.content_type.strip().lower()
        if not filename and not content_type:
            continue
        normalized.append(
            AttachmentDescriptor(
                filename=filename,
                content_type=content_type,
            )
        )
    return tuple(normalized)


def _build_attachment_context(
    attachment_descriptors: tuple[AttachmentDescriptor, ...],
) -> str:
    if not attachment_descriptors:
        return ""

    lines = ["Uploaded attachments:"]
    for descriptor in attachment_descriptors:
        parts = []
        if descriptor.filename:
            parts.append(f"filename={descriptor.filename}")
        if descriptor.content_type:
            parts.append(f"content_type={descriptor.content_type}")
        if parts:
            lines.append(f"- {'; '.join(parts)}")
    return "\n".join(lines)


def _has_analysis_intent(user_message: str) -> bool:
    return _ANALYSIS_INTENT_RE.search(user_message) is not None


def _is_data_attachment(descriptor: AttachmentDescriptor) -> bool:
    filename = descriptor.filename.lower()
    content_type = descriptor.content_type.lower()
    return filename.endswith(_DATA_FILE_SUFFIXES) or any(
        marker in content_type for marker in _DATA_MIME_MARKERS
    )


def _select_data_analysis_from_attachments(
    user_message: str,
    attachment_descriptors: tuple[AttachmentDescriptor, ...],
    skill_registry: SkillRegistry,
) -> SkillContent | None:
    if not attachment_descriptors or not _has_analysis_intent(user_message):
        return None
    if not any(
        _is_data_attachment(descriptor) for descriptor in attachment_descriptors
    ):
        return None
    return skill_registry.find_by_name("data-analysis")


def _should_probe_model_selector(
    user_message: str,
    attachment_descriptors: tuple[AttachmentDescriptor, ...],
    fallback: SkillContent | None,
) -> bool:
    if fallback is not None:
        return True
    if attachment_descriptors and _has_analysis_intent(user_message):
        return True
    return _SKILL_MODEL_PROBE_RE.search(user_message) is not None


async def select_skill_for_message(
    *,
    user_message: str,
    selected_skills: tuple[str, ...],
    attachment_descriptors: tuple[AttachmentDescriptor, ...] = (),
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

    normalized_attachments = _normalize_attachment_descriptors(attachment_descriptors)
    attachment_skill = _select_data_analysis_from_attachments(
        user_message,
        normalized_attachments,
        skill_registry,
    )
    if attachment_skill is not None:
        logger.info(
            "skill_selector_attachment_hint name={} attachments={}",
            attachment_skill.metadata.name,
            len(normalized_attachments),
        )
        return attachment_skill

    attachment_context = _build_attachment_context(normalized_attachments)
    selector_input = (
        f"{user_message}\n\n{attachment_context}"
        if attachment_context
        else user_message
    )
    fallback = skill_registry.match_description(selector_input)
    if not _should_probe_model_selector(
        user_message,
        normalized_attachments,
        fallback,
    ):
        logger.info("skill_selector_no_match")
        return None

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
            messages=[{"role": "user", "content": selector_input}],
            model=model,
            max_tokens=128,
        )
        if not response.text.strip():
            logger.warning(
                "skill_selector_model_empty_response, falling back to keyword"
            )
            raise ValueError("empty response text")
        parsed = _parse_skill_selector_json(response.text)
        if parsed is None:
            raise ValueError("unparseable skill selector JSON")
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
    if fallback is None:
        logger.info("skill_selector_no_keyword_fallback")
        return None
    logger.info("skill_selector_keyword_fallback name={}", fallback.metadata.name)
    return fallback
