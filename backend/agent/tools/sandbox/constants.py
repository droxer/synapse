"""Shared artifact eligibility constants for sandbox tools."""

from __future__ import annotations

import os

# Extensions automatically surfaced as user-facing artifacts when tools omit
# explicit hints. These are deliverables that users typically expect to see.
AUTO_ARTIFACT_EXTENSIONS = frozenset(
    {
        ".doc",
        ".docx",
        ".ppt",
        ".pptx",
        ".xls",
        ".xlsx",
        ".pdf",
        ".html",
        ".htm",
        ".csv",
        ".tsv",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".zip",
        ".tar",
        ".gz",
        ".mp4",
        ".mp3",
    }
)

# Extensions that remain valid artifacts only when explicitly marked by the
# model/user, since they are often helper files, logs, or intermediates.
EXPLICIT_ONLY_ARTIFACT_EXTENSIONS = frozenset(
    {
        ".txt",
        ".md",
        ".json",
        ".xml",
    }
)

# Full set of artifact extensions recognized by the artifact pipeline.
ARTIFACT_EXTENSIONS = AUTO_ARTIFACT_EXTENSIONS | EXPLICIT_ONLY_ARTIFACT_EXTENSIONS


def artifact_extension(path: str) -> str:
    """Return the normalized lowercase extension for *path*."""
    _, ext = os.path.splitext(path)
    return ext.lower()


def is_auto_artifact_path(path: str) -> bool:
    """Return True when *path* should auto-surface as an artifact."""
    return artifact_extension(path) in AUTO_ARTIFACT_EXTENSIONS


def is_trackable_artifact_path(path: str) -> bool:
    """Return True when *path* is supported by artifact tracking at all."""
    return artifact_extension(path) in ARTIFACT_EXTENSIONS
