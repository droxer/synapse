"""Runtime-specific context compaction profiles."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, cast

from config.settings import Settings, TokenCounterStrategy

CompactionRuntimeKind = Literal[
    "web_conversation",
    "channel_conversation",
    "planner",
    "task_agent",
]

_PROFILE_PREFIX_BY_KIND: dict[CompactionRuntimeKind, str] = {
    "web_conversation": "WEB",
    "channel_conversation": "CHANNEL",
    "planner": "PLANNER",
    "task_agent": "TASK_AGENT",
}

_KNOWN_RUNTIME_KINDS = set(_PROFILE_PREFIX_BY_KIND)
_BASE_DEFAULTS = {
    "TOKEN_BUDGET": 150_000,
    "TOKEN_COUNTER": "weighted",
    "FULL_INTERACTIONS": 5,
    "FALLBACK_PREVIEW_CHARS": 500,
    "FALLBACK_RESULT_CHARS": 1000,
    "SUMMARY_MODEL": "",
    "FULL_DIALOGUE_TURNS": 5,
    "DIALOGUE_FALLBACK_CHARS": 12_000,
    "CONTEXT_SUMMARY_MAX_CHARS": 32_000,
    "RECONSTRUCT_TAIL_MESSAGES": 80,
    "MEMORY_FLUSH": False,
}


@dataclass(frozen=True)
class CompactionProfile:
    """Resolved compaction policy for a specific runtime surface."""

    name: str
    token_budget: int
    token_counter: TokenCounterStrategy
    max_full_interactions: int
    fallback_preview_chars: int
    fallback_result_chars: int
    summary_model: str
    max_full_dialogue_turns: int
    dialogue_fallback_chars: int
    context_summary_max_chars: int
    reconstruct_tail_messages: int
    memory_flush: bool


def resolve_compaction_profile(
    settings: Settings,
    runtime: CompactionRuntimeKind,
) -> CompactionProfile:
    """Resolve runtime-specific compaction settings with inheritance."""

    prefix = _PROFILE_PREFIX_BY_KIND[runtime]
    return CompactionProfile(
        name=runtime,
        token_budget=_get_override(
            settings,
            prefix,
            "TOKEN_BUDGET",
            _base_value(settings, "TOKEN_BUDGET"),
        ),
        token_counter=_get_override(
            settings,
            prefix,
            "TOKEN_COUNTER",
            _base_value(settings, "TOKEN_COUNTER"),
        ),
        max_full_interactions=_get_override(
            settings,
            prefix,
            "FULL_INTERACTIONS",
            _base_value(settings, "FULL_INTERACTIONS"),
        ),
        fallback_preview_chars=_get_override(
            settings,
            prefix,
            "FALLBACK_PREVIEW_CHARS",
            _base_value(settings, "FALLBACK_PREVIEW_CHARS"),
        ),
        fallback_result_chars=_get_override(
            settings,
            prefix,
            "FALLBACK_RESULT_CHARS",
            _base_value(settings, "FALLBACK_RESULT_CHARS"),
        ),
        summary_model=_get_override(
            settings,
            prefix,
            "SUMMARY_MODEL",
            _base_value(settings, "SUMMARY_MODEL"),
        ),
        max_full_dialogue_turns=_get_override(
            settings,
            prefix,
            "FULL_DIALOGUE_TURNS",
            _base_value(settings, "FULL_DIALOGUE_TURNS"),
        ),
        dialogue_fallback_chars=_get_override(
            settings,
            prefix,
            "DIALOGUE_FALLBACK_CHARS",
            _base_value(settings, "DIALOGUE_FALLBACK_CHARS"),
        ),
        context_summary_max_chars=_get_override(
            settings,
            prefix,
            "CONTEXT_SUMMARY_MAX_CHARS",
            _base_value(settings, "CONTEXT_SUMMARY_MAX_CHARS"),
        ),
        reconstruct_tail_messages=_get_override(
            settings,
            prefix,
            "RECONSTRUCT_TAIL_MESSAGES",
            _base_value(settings, "RECONSTRUCT_TAIL_MESSAGES"),
        ),
        memory_flush=_get_override(
            settings,
            prefix,
            "MEMORY_FLUSH",
            _base_value(settings, "MEMORY_FLUSH"),
        ),
    )


def resolve_compaction_profile_by_name(
    settings: Settings,
    profile_name: str | None,
    *,
    default: CompactionRuntimeKind = "web_conversation",
) -> CompactionProfile:
    """Resolve *profile_name* when read from persisted event metadata."""

    runtime = profile_name if profile_name in _KNOWN_RUNTIME_KINDS else default
    return resolve_compaction_profile(settings, cast(CompactionRuntimeKind, runtime))


def _get_override(
    settings: Settings,
    prefix: str,
    suffix: str,
    fallback: TokenCounterStrategy | int | str | bool,
) -> TokenCounterStrategy | int | str | bool:
    value = getattr(settings, f"COMPACT_{prefix}_{suffix}", None)
    return fallback if value is None else value


def _base_value(
    settings: Settings,
    suffix: str,
) -> TokenCounterStrategy | int | str | bool:
    return getattr(settings, f"COMPACT_{suffix}", _BASE_DEFAULTS[suffix])
