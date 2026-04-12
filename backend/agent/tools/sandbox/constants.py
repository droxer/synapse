"""Shared constants for sandbox tools."""

from __future__ import annotations

# File extensions treated as output artifacts (not intermediate code/scripts).
# Used by code_run (auto-detection) and file_write (heuristic).
ARTIFACT_EXTENSIONS = frozenset(
    {
        ".docx",
        ".pptx",
        ".xlsx",
        ".pdf",
        ".csv",
        ".txt",
        ".md",
        ".png",
        ".jpg",
        ".jpeg",
        ".gif",
        ".svg",
        ".webp",
        ".zip",
        ".tar",
        ".gz",
        ".json",
        ".xml",
        ".mp4",
        ".mp3",
    }
)
