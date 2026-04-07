"""Shared helpers for skill-driven runtime behavior."""

from __future__ import annotations


def split_allowed_tools(
    allowed_tools: tuple[str, ...],
) -> tuple[set[str], set[str]]:
    """Split skill ``allowed_tools`` into tool names and registry tags."""
    names: set[str] = {"activate_skill"}
    tags: set[str] = set()
    for entry in allowed_tools:
        if ":" in entry:
            tags.add(entry)
        else:
            names.add(entry)
    return names, tags
