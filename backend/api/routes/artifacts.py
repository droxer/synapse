"""Artifact and preview proxy route handlers."""

from __future__ import annotations

import base64
import os
import posixpath
import shlex
import uuid
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, Depends, HTTPException, Path, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

from agent.artifacts.storage import LocalStorageBackend
from api.artifact_previews import (
    ArtifactPreviewError,
    PreviewSlideNotFoundError,
    UnsupportedArtifactPreviewError,
    artifact_preview_cache,
)
from api.dependencies import AppState, get_app_state, get_db_session
from api.auth import AuthUser, common_dependencies, get_current_user
from api.routes.conversations import _verify_conversation_ownership

# UUID pattern for path parameter validation
_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Default port for sandbox preview proxy
_DEFAULT_PREVIEW_PORT = 8080
_PREVIEW_HEADERS_START = "__SYNAPSE_PREVIEW_HEADERS_START__"
_PREVIEW_HEADERS_END = "__SYNAPSE_PREVIEW_HEADERS_END__"
_PREVIEW_BODY_START = "__SYNAPSE_PREVIEW_BODY_START__"
_PREVIEW_BODY_END = "__SYNAPSE_PREVIEW_BODY_END__"


class BulkDeleteRequest(BaseModel):
    artifact_ids: list[str]


router = APIRouter(dependencies=common_dependencies)


@router.get("/conversations/{conversation_id}/artifacts")
async def list_conversation_artifacts(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    await _verify_conversation_ownership(state, conversation_id, auth_user)
    records = await state.db_repo.list_artifacts(session, uuid.UUID(conversation_id))
    return {
        "artifacts": [
            {
                "id": record.id,
                "name": record.original_name,
                "original_name": record.original_name,
                "content_type": record.content_type,
                "size": record.size,
                "file_path": record.file_path,
                "created_at": record.created_at.isoformat(),
            }
            for record in records
        ]
    }


@router.delete("/conversations/{conversation_id}/artifacts/bulk")
async def bulk_delete_artifacts(
    request: BulkDeleteRequest,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict:
    await _verify_conversation_ownership(state, conversation_id, auth_user)
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
    auth_user: AuthUser | None = Depends(get_current_user),
) -> FileResponse | RedirectResponse:
    """Serve an artifact file.

    Looks up artifact metadata from the database, then delegates
    to the storage backend (local file or R2 presigned URL).
    """
    await _verify_conversation_ownership(state, conversation_id, auth_user)
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


@router.get("/conversations/{conversation_id}/artifacts/{artifact_id}/preview")
async def get_artifact_preview_manifest(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    artifact_id: str = Path(..., pattern=r"^[0-9a-f]{32}$"),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    await _verify_conversation_ownership(state, conversation_id, auth_user)
    record = await state.db_repo.get_artifact(session, artifact_id)
    if record is None or str(record.conversation_id) != conversation_id:
        raise HTTPException(
            status_code=404, detail=f"Artifact not found: {artifact_id}"
        )

    try:
        manifest = await artifact_preview_cache.ensure_ppt_preview(
            record, state.storage_backend
        )
    except UnsupportedArtifactPreviewError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except ArtifactPreviewError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "kind": manifest.kind,
        "file_name": manifest.file_name,
        "slide_count": manifest.slide_count,
        "slides": [
            {
                "index": index + 1,
                "image_url": (
                    f"/api/conversations/{conversation_id}/artifacts/{artifact_id}/preview/"
                    f"slides/{index + 1}"
                ),
            }
            for index in range(manifest.slide_count)
        ],
    }


@router.get(
    "/conversations/{conversation_id}/artifacts/{artifact_id}/preview/slides/{slide_index}",
    response_model=None,
)
async def get_artifact_preview_slide(
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    artifact_id: str = Path(..., pattern=r"^[0-9a-f]{32}$"),
    slide_index: int = Path(..., ge=1),
    session: Any = Depends(get_db_session),
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> FileResponse:
    await _verify_conversation_ownership(state, conversation_id, auth_user)
    record = await state.db_repo.get_artifact(session, artifact_id)
    if record is None or str(record.conversation_id) != conversation_id:
        raise HTTPException(
            status_code=404, detail=f"Artifact not found: {artifact_id}"
        )

    try:
        slide_path = await artifact_preview_cache.get_slide_path(
            record, state.storage_backend, slide_index
        )
    except UnsupportedArtifactPreviewError as exc:
        raise HTTPException(status_code=415, detail=str(exc)) from exc
    except PreviewSlideNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ArtifactPreviewError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FileResponse(path=slide_path, media_type="image/png")


@router.api_route(
    "/conversations/{conversation_id}/preview/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE"],
)
async def proxy_preview(
    request: Request,
    conversation_id: str = Path(..., pattern=_UUID_PATTERN),
    path: str = "",
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> StreamingResponse:
    """Proxy requests to a preview server running in the conversation's sandbox."""
    await _verify_conversation_ownership(state, conversation_id, auth_user)

    entry = state.conversations.get(conversation_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown conversation")
    if entry.executor is None:
        raise HTTPException(
            status_code=503, detail="Conversation runtime is still starting"
        )

    sessions = entry.executor._sandbox_sessions
    port = _DEFAULT_PREVIEW_PORT
    port_param = request.query_params.get("_port")
    if port_param and port_param.isdigit():
        port = int(port_param)
    if port < 1024 or port > 65535:
        raise HTTPException(
            status_code=400,
            detail="Preview port must be between 1024 and 65535",
        )

    sandbox_session = await _select_preview_sandbox_session(sessions, port)
    if sandbox_session is None:
        raise HTTPException(status_code=503, detail="No sandbox session active")

    query_items = [
        (key, value)
        for key, value in request.query_params.multi_items()
        if key != "_port"
    ]
    query = urlencode(query_items, doseq=True)

    method = request.method
    url = f"http://localhost:{port}/{path}"
    if query:
        url = f"{url}?{query}"

    headers: list[str] = []
    content_type = request.headers.get("content-type")
    if content_type:
        headers.extend(["-H", f"content-type: {content_type}"])

    body = await request.body()
    response_id = uuid.uuid4().hex
    headers_path = f"/tmp/synapse_preview_{response_id}.headers"
    body_path = f"/tmp/synapse_preview_{response_id}.body"
    curl_parts = [
        "curl",
        "-sS",
        "-D",
        headers_path,
        "-o",
        body_path,
        "-X",
        method,
    ]
    curl_parts.extend(headers)
    if body:
        curl_parts.append("--data-binary @-")
    curl_parts.append(url)
    curl_cmd = " ".join(shlex.quote(part) for part in curl_parts)
    if body:
        encoded_body = base64.b64encode(body).decode("ascii")
        curl_cmd = f"printf %s {shlex.quote(encoded_body)} | base64 -d | {curl_cmd}"

    quoted_headers_path = shlex.quote(headers_path)
    quoted_body_path = shlex.quote(body_path)
    command = (
        f"rm -f {quoted_headers_path} {quoted_body_path}; "
        f"{curl_cmd}; curl_status=$?; "
        f"printf '\\n{_PREVIEW_HEADERS_START}\\n'; "
        f"cat {quoted_headers_path} 2>/dev/null; "
        f"printf '\\n{_PREVIEW_HEADERS_END}\\n{_PREVIEW_BODY_START}\\n'; "
        f"base64 < {quoted_body_path} 2>/dev/null; "
        f"printf '\\n{_PREVIEW_BODY_END}\\n'; "
        f"rm -f {quoted_headers_path} {quoted_body_path}; "
        "exit $curl_status"
    )

    result = await sandbox_session.exec(command, timeout=15)

    if result.exit_code != 0:
        raise HTTPException(
            status_code=502,
            detail=(f"Preview proxy failed: {result.stderr or 'connection refused'}"),
        )

    headers_raw = _extract_preview_section(
        result.stdout, _PREVIEW_HEADERS_START, _PREVIEW_HEADERS_END
    )
    body_encoded = _extract_preview_section(
        result.stdout, _PREVIEW_BODY_START, _PREVIEW_BODY_END
    )
    if headers_raw is None or body_encoded is None:
        raise HTTPException(
            status_code=502,
            detail="Preview proxy returned an invalid response",
        )

    try:
        response_body = base64.b64decode(body_encoded.strip())
    except ValueError as exc:
        raise HTTPException(
            status_code=502,
            detail="Preview proxy returned an invalid response body",
        ) from exc

    response_status = 200
    response_headers: dict[str, str] = {}
    content_type = "text/html"
    proxy_base = f"/api/conversations/{conversation_id}/preview"

    def _proxy_location(location: str) -> str:
        localhost_prefix = f"http://localhost:{port}"
        if location.startswith(localhost_prefix):
            location = location[len(localhost_prefix) :] or "/"
        if location.startswith("/") and not location.startswith("//"):
            location = f"{proxy_base}{location}"
        elif location and not location.startswith("#"):
            parsed = urlsplit(location)
            if not parsed.scheme and not parsed.netloc:
                normalized_path = posixpath.normpath(f"/{parsed.path}")
                if normalized_path == ".":
                    normalized_path = "/"
                location = urlunsplit(
                    (
                        "",
                        "",
                        f"{proxy_base}{normalized_path}",
                        parsed.query,
                        parsed.fragment,
                    )
                )
        if port != _DEFAULT_PREVIEW_PORT and location.startswith(proxy_base):
            parsed = urlsplit(location)
            if "_port=" not in parsed.query:
                query = (
                    f"{parsed.query}&_port={port}" if parsed.query else f"_port={port}"
                )
                location = urlunsplit(
                    (
                        parsed.scheme,
                        parsed.netloc,
                        parsed.path,
                        query,
                        parsed.fragment,
                    )
                )
        return location

    first_line = headers_raw.splitlines()[0] if headers_raw.splitlines() else ""
    parts = first_line.split()
    if len(parts) >= 2 and parts[1].isdigit():
        response_status = int(parts[1])

    for line in headers_raw.split("\n"):
        name, sep, value = line.partition(":")
        if not sep:
            continue
        header_name = name.strip().lower()
        header_value = value.strip()
        if header_name == "content-type":
            content_type = header_value
        elif header_name == "location":
            response_headers["location"] = _proxy_location(header_value)

    return StreamingResponse(
        iter([response_body]),
        media_type=content_type,
        status_code=response_status,
        headers=response_headers,
    )


async def _select_preview_sandbox_session(
    sessions: dict[str, Any],
    port: int,
) -> Any | None:
    """Prefer the sandbox session with a live preview server on the requested port."""
    if not sessions:
        return None
    if len(sessions) == 1:
        return next(iter(sessions.values()))

    probe_cmd = f"curl -sS -m 1 -o /dev/null {shlex.quote(f'http://localhost:{port}/')}"
    for session in sessions.values():
        result = await session.exec(probe_cmd, timeout=3)
        if result.exit_code == 0:
            return session

    return sessions.get("default") or next(iter(sessions.values()))


def _extract_preview_section(
    output: str, start_marker: str, end_marker: str
) -> str | None:
    start_index = output.find(start_marker)
    if start_index == -1:
        return None
    start_index += len(start_marker)
    end_index = output.find(end_marker, start_index)
    if end_index == -1:
        return None
    return output[start_index:end_index].strip("\r\n")
