"""Image generation tool using the MiniMax image-01 API."""

from __future__ import annotations

import base64
from typing import Any

import httpx
from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)
from api.events import EventEmitter, EventType

_DEFAULT_HOST = "https://api.minimaxi.com"
_IMAGE_GEN_PATH = "/v1/image_generation"

_VALID_ASPECT_RATIOS = frozenset({"1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"})


class MiniMaxAPIError(Exception):
    """Raised when MiniMax returns a business-level error (HTTP 200 but base_resp error)."""

    def __init__(self, status_code: int, status_msg: str) -> None:
        self.status_code = status_code
        self.status_msg = status_msg
        super().__init__(f"MiniMax error {status_code}: {status_msg}")


class ImageGen(LocalTool):
    """Generate images from text prompts using MiniMax image-01."""

    def __init__(
        self,
        api_key: str,
        artifact_manager: ArtifactManager,
        event_emitter: EventEmitter,
        api_host: str = _DEFAULT_HOST,
    ) -> None:
        if not api_key:
            raise ValueError("MiniMax API key must not be empty")
        self._api_key = api_key
        self._artifact_manager = artifact_manager
        self._event_emitter = event_emitter
        self._api_url = api_host.rstrip("/") + _IMAGE_GEN_PATH

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="image_generate",
            description=(
                "Generate images from a text prompt using MiniMax image-01. "
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
                            "Aspect ratio of the generated image. "
                            "One of: 1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16."
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

        if aspect_ratio not in _VALID_ASPECT_RATIOS:
            return ToolResult.fail(
                f"Invalid aspect_ratio '{aspect_ratio}'. "
                f"Must be one of: {', '.join(sorted(_VALID_ASPECT_RATIOS))}"
            )

        try:
            images_b64 = await self._call_api(prompt, aspect_ratio)
        except MiniMaxAPIError as exc:
            logger.error("MiniMax API business error: {}", exc)
            return ToolResult.fail(str(exc))
        except httpx.HTTPStatusError as exc:
            logger.error("MiniMax API HTTP error: {}", exc)
            return ToolResult.fail(
                f"MiniMax API error (HTTP {exc.response.status_code}): "
                f"{exc.response.text[:200]}"
            )
        except httpx.HTTPError as exc:
            logger.error("MiniMax API request failed: {}", exc)
            return ToolResult.fail(f"MiniMax API request failed: {exc}")

        if not images_b64:
            return ToolResult.fail("MiniMax API returned no images")

        artifact_ids: list[str] = []
        for idx, img_b64 in enumerate(images_b64):
            image_bytes = base64.b64decode(img_b64)
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
                },
            )

        summary = f'Generated {len(artifact_ids)} image(s) for prompt: "{prompt[:100]}"'
        return ToolResult.ok(
            summary,
            metadata={"artifact_ids": artifact_ids, "count": len(artifact_ids)},
        )

    async def _call_api(
        self,
        prompt: str,
        aspect_ratio: str,
    ) -> list[str]:
        """Call MiniMax image generation API and return base64-encoded images.

        Raises:
            MiniMaxAPIError: If the API returns a business-level error.
            httpx.HTTPStatusError: If the HTTP status code indicates failure.
            httpx.HTTPError: For connection/transport errors.
        """
        async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
            response = await client.post(
                self._api_url,
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "image-01",
                    "prompt": prompt,
                    "aspect_ratio": aspect_ratio,
                    "response_format": "base64",
                },
            )
            response.raise_for_status()

        body = response.json()

        # MiniMax returns HTTP 200 even for errors, with error info in base_resp
        base_resp = body.get("base_resp", {})
        resp_code = base_resp.get("status_code", 0)
        if resp_code != 0:
            raise MiniMaxAPIError(
                status_code=resp_code,
                status_msg=base_resp.get("status_msg", "unknown error"),
            )

        # Response format: {"data": {"image_base64": ["base64_string", ...]}}
        data = body.get("data", {})
        if isinstance(data, dict):
            return data.get("image_base64", [])

        logger.warning("MiniMax API unexpected response structure: {}", list(body.keys()))
        return []
