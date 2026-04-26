"""Local tool for creating user-visible Markdown artifacts."""

from __future__ import annotations

import re
from typing import Any

from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.tools.base import ExecutionContext, LocalTool, ToolDefinition, ToolResult
from api.events import EventEmitter, EventType


def _slugify_ascii(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:72].strip("-") or "report"


def _normalize_markdown_filename(title: str, filename: str | None) -> str:
    base = (filename or "").strip()
    if base:
        base = base.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if not base.endswith(".md"):
            base = f"{base}.md"
        return base
    return f"{_slugify_ascii(title)}.md"


class CreateMarkdownArtifact(LocalTool):
    """Create a Markdown artifact that appears in the conversation artifacts panel."""

    def __init__(
        self,
        *,
        artifact_manager: ArtifactManager,
        event_emitter: EventEmitter,
    ) -> None:
        self._artifact_manager = artifact_manager
        self._event_emitter = event_emitter

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="create_markdown_artifact",
            title="Create Markdown Artifact",
            description=(
                "Create a user-visible Markdown artifact for substantial reports, "
                "audits, research results, comparisons, or long structured outputs. "
                "Use this when the full result is better opened in the artifacts "
                "panel than pasted into the conversation. After calling it, reply "
                "briefly in the conversation and do not duplicate the whole report."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Short human-readable report title.",
                    },
                    "content": {
                        "type": "string",
                        "description": "Complete Markdown content for the artifact.",
                    },
                    "filename": {
                        "type": "string",
                        "description": "Optional .md filename. Defaults to a slug from title.",
                    },
                },
                "required": ["title", "content"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("artifact", "markdown", "report"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        title = str(kwargs.get("title") or "").strip()
        content = str(kwargs.get("content") or "").strip()
        filename = _normalize_markdown_filename(
            title or "report",
            str(kwargs["filename"]) if kwargs.get("filename") else None,
        )

        if not title:
            return ToolResult.fail("title must not be empty")
        if not content:
            return ToolResult.fail("content must not be empty")

        try:
            artifact = await self._artifact_manager.register_local_artifact(
                data=content.encode("utf-8"),
                filename=filename,
            )
            await self._event_emitter.emit(
                EventType.ARTIFACT_CREATED,
                {
                    "artifact_id": artifact.id,
                    "storage_key": artifact.path,
                    "name": artifact.original_name,
                    "content_type": artifact.content_type,
                    "size": artifact.size,
                    "file_path": artifact.file_path,
                },
            )
        except Exception as exc:
            logger.warning("create_markdown_artifact_failed error={}", exc)
            return ToolResult.fail(f"Failed to create Markdown artifact: {exc}")

        return ToolResult.ok(
            f"Created Markdown artifact: {artifact.original_name}",
            metadata={
                "artifact_ids": [artifact.id],
                "content_type": artifact.content_type,
            },
        )
