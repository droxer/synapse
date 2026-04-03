"""Shared user-turn attachment upload and multimodal message building."""

from __future__ import annotations

import base64
import os
import re
import tempfile
from typing import Any

from loguru import logger

from agent.sandbox.base import SANDBOX_HOME_DIR
from agent.tools.executor import ToolExecutor
from api.models import VISION_MIME_TYPES


def safe_attachment_filename(filename: str) -> str:
    """Return a display-safe basename stripped of path separators."""
    name = os.path.basename(filename)
    name = re.sub(r"[^\w.\- ]", "_", name)
    return name.strip() or "unnamed"


async def upload_attachments_to_sandbox(
    executor: ToolExecutor,
    attachments: tuple[Any, ...],
) -> tuple[str, ...]:
    """Upload file attachments into ``~/uploads`` in the active sandbox."""
    import shlex

    upload_dir = f"{SANDBOX_HOME_DIR}/uploads"
    session = await executor.get_sandbox_session()
    sandbox_id = getattr(session, "sandbox_id", None)
    logger.info(
        "upload_session_ready sandbox_id={} upload_dir={}",
        sandbox_id or "unknown",
        upload_dir,
    )
    mkdir_result = await session.exec(f"mkdir -p {shlex.quote(upload_dir)}")
    if not mkdir_result.success:
        raise RuntimeError(
            f"Failed to prepare upload directory '{upload_dir}': "
            f"{mkdir_result.stderr or mkdir_result.stdout}"
        )

    uploaded_paths: list[str] = []

    for att in attachments:
        safe_name = safe_attachment_filename(att.filename)
        remote_path = f"{upload_dir}/{safe_name}"
        try:
            with tempfile.NamedTemporaryFile(
                delete=False, suffix=f"_{safe_name}"
            ) as tmp:
                tmp.write(att.data)
                tmp_path = tmp.name
            try:
                await session.upload_file(tmp_path, remote_path)
            finally:
                os.unlink(tmp_path)
            verify_result = await session.exec(f"test -f {shlex.quote(remote_path)}")
            if not verify_result.success:
                raise RuntimeError(f"Uploaded file was not found at '{remote_path}'")
            uploaded_paths.append(remote_path)
            logger.info(
                "uploaded_file sandbox_id={} remote_path={} filename={} size={}",
                sandbox_id or "unknown",
                remote_path,
                safe_name,
                att.size,
            )
        except Exception as exc:
            logger.error(
                "file_upload_failed sandbox_id={} remote_path={} filename={} error={}",
                sandbox_id or "unknown",
                remote_path,
                att.filename,
                exc,
            )
            raise RuntimeError(
                f"Failed to upload '{safe_name}' to the sandbox"
            ) from exc

    return tuple(uploaded_paths)


def build_user_message_content(
    user_message: str,
    attachments: tuple[Any, ...],
    uploaded_paths: tuple[str, ...] = (),
) -> str | list[dict[str, Any]]:
    """Build user message content, adding multimodal blocks for attachments."""
    if not attachments:
        return user_message

    blocks: list[dict[str, Any]] = []
    sandbox_files = list(uploaded_paths)

    for att in attachments:
        if att.content_type in VISION_MIME_TYPES:
            encoded = base64.standard_b64encode(att.data).decode("ascii")
            if att.content_type == "application/pdf":
                blocks.append(
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": att.content_type,
                            "data": encoded,
                        },
                    }
                )
            else:
                blocks.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": att.content_type,
                            "data": encoded,
                        },
                    }
                )

    text = user_message
    if sandbox_files:
        listing = "\n".join(f"  - {path}" for path in sandbox_files)
        text += f"\n\n[Uploaded files in sandbox:\n{listing}]"

    blocks.append({"type": "text", "text": text})
    return blocks
