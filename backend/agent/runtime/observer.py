"""Compatibility shim for context compaction imports.

Prefer importing compaction logic from ``agent.context.compaction``.
"""

from agent.context.compaction import *  # noqa: F403
