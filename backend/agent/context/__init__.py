"""Context-window management utilities for agent runs."""

from agent.context.compaction import Observer, compaction_summary_for_persistence
from agent.context.profiles import (
    CompactionProfile,
    CompactionRuntimeKind,
    resolve_compaction_profile,
    resolve_compaction_profile_by_name,
)

__all__ = [
    "CompactionProfile",
    "CompactionRuntimeKind",
    "Observer",
    "compaction_summary_for_persistence",
    "resolve_compaction_profile",
    "resolve_compaction_profile_by_name",
]
