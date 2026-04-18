"""Image generation tool using a pluggable ImageGenerationClient."""

from __future__ import annotations

from typing import Any

from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.llm.image import ImageGenerationClient, ImageGenerationError
from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)
from api.events import EventEmitter, EventType


class ImageGen(LocalTool):
    """Generate images from text prompts using a pluggable image generation client."""

    def __init__(
        self,
        client: ImageGenerationClient,
        artifact_manager: ArtifactManager,
        event_emitter: EventEmitter,
    ) -> None:
        self._client = client
        self._artifact_manager = artifact_manager
        self._event_emitter = event_emitter

    def definition(self) -> ToolDefinition:
        ratios = ", ".join(sorted(self._client.valid_aspect_ratios))
        return ToolDefinition(
            name="image_generate",
            description=(
                "Generate images from a text prompt. "
                "Returns artifact metadata for each generated image."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "A description of the image to generate.",
                    },
                    "aspect_ratio": {
                        "type": "string",
                        "description": (
                            f"Aspect ratio of the generated image. One of: {ratios}."
                        ),
                        "default": "1:1",
                    },
                },
                "required": ["prompt"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("image", "generation"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        prompt: str = kwargs.get("prompt", "")
        aspect_ratio: str = kwargs.get("aspect_ratio", "1:1")

        if not prompt.strip():
            return ToolResult.fail("Prompt must not be empty")

        try:
            images = await self._client.generate(prompt, aspect_ratio)
        except ImageGenerationError as exc:
            logger.error("Image generation error: {}", exc)
            return ToolResult.fail(str(exc))

        if not images:
            return ToolResult.fail("Image generation returned no images")

        artifact_ids: list[str] = []
        for idx, image_bytes in enumerate(images):
            filename = f"generated_image_{idx + 1}.jpeg"

            artifact = await self._artifact_manager.register_local_artifact(
                data=image_bytes,
                filename=filename,
            )
            artifact_ids.append(artifact.id)

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

        summary = f'Generated {len(artifact_ids)} image(s) for prompt: "{prompt[:100]}"'
        return ToolResult.ok(
            summary,
            metadata={"artifact_ids": artifact_ids, "count": len(artifact_ids)},
        )
