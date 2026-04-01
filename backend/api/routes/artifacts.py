"""Artifact and preview proxy route handlers."""

from __future__ import annotations

import os
import shlex
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

from agent.artifacts.storage import LocalStorageBackend
from api.dependencies import AppState, get_app_state, get_db_session
from api.auth import common_dependencies

# UUID pattern for path parameter validation
_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Default port for sandbox preview proxy
_DEFAULT_PREVIEW_PORT = 8080


class BulkDeleteRequest(BaseModel):
    artifact_ids: list[str]


router = APIRouter(dependencies=common_dependencies)


@router.delete("/conversations/{conversation_id}/artifacts/bulk")
async def bulk_delete_artifacts(
    request: BulkDeleteRequest,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> dict:
    deleted_count = await state.db_repo.delete_artifacts(
        session, uuid.UUID(conversation_id), request.artifact_ids
    )
    return {"deleted": deleted_count}


@router.get(
    "/conversations/{conversation_id}/artifacts/{artifact_id}",
    response_model=None,
)
async def get_artifact(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    artifact_id: str = Path(..., pattern=r"^[0-9a-f]{32}$"),
    inline: bool = False,
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
) -> FileResponse | RedirectResponse:
    """Serve an artifact file.

    Looks up artifact metadata from the database, then delegates
    to the storage backend (local file or R2 presigned URL).
    """
    record = await state.db_repo.get_artifact(session, artifact_id)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail=f"Artifact not found: {artifact_id}",
        )

    # Verify artifact belongs to this conversation
    if str(record.conversation_id) != conversation_id:
        raise HTTPException(
            status_code=404,
            detail=f"Artifact not found: {artifact_id}",
        )

    # Local storage: serve the file directly
    if isinstance(state.storage_backend, LocalStorageBackend):
        file_path = await state.storage_backend.get_url(
            record.storage_key, record.content_type, record.original_name
        )
        if not os.path.isfile(file_path):
            raise HTTPException(
                status_code=404,
                detail="Artifact file not found on disk",
            )
        return FileResponse(
            path=file_path,
            media_type=record.content_type,
            filename=None if inline else record.original_name,
        )

    # Remote storage (R2): redirect to presigned URL
    url = await state.storage_backend.get_url(
        record.storage_key, record.content_type, record.original_name
    )
    return RedirectResponse(url=url, status_code=307)


@router.api_route(
    "/conversations/{conversation_id}/preview/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
)
async def proxy_preview(
    request: Request,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    path: str = "",
    state: AppState = Depends(get_app_state),
) -> StreamingResponse:
    """Proxy requests to a preview server running in the conversation's sandbox."""
    entry = state.conversations.get(conversation_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown conversation")

    # Get the sandbox session from the executor (try "default" first, then any active session)
    sessions = entry.executor._sandbox_sessions
    sandbox_session = sessions.get("default") or next(iter(sessions.values()), None)
    if sandbox_session is None:
        raise HTTPException(status_code=503, detail="No sandbox session active")

    # Default preview port
    port = _DEFAULT_PREVIEW_PORT
    # Try to extract port from query params
    port_param = request.query_params.get("_port")
    if port_param and port_param.isdigit():
        port = int(port_param)

    # Use curl inside the sandbox to fetch the content
    method = request.method
    url = f"http://localhost:{port}/{path}"

    curl_cmd = f"curl -s -i -X {shlex.quote(method)} {shlex.quote(url)}"
    result = await sandbox_session.exec(curl_cmd, timeout=15)

    if result.exit_code != 0:
        raise HTTPException(
            status_code=502,
            detail=(f"Preview proxy failed: {result.stderr or 'connection refused'}"),
        )

    # Parse the HTTP response from curl -i output
    output = result.stdout
    header_end = output.find("\r\n\r\n")
    if header_end == -1:
        header_end = output.find("\n\n")

    if header_end == -1:
        # No headers found, return raw output
        return StreamingResponse(
            iter([output.encode()]),
            media_type="text/html",
        )

    headers_raw = output[:header_end]
    body = output[header_end:].lstrip("\r\n")

    # Extract content-type from headers
    content_type = "text/html"
    for line in headers_raw.split("\n"):
        if line.lower().startswith("content-type:"):
            content_type = line.split(":", 1)[1].strip()
            break

    return StreamingResponse(
        iter([body.encode()]),
        media_type=content_type,
    )
