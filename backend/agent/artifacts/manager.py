"""Artifact management for extracting files from sandboxes.

Provides an ``ArtifactManager`` that downloads files from sandbox
sessions to storage (local or R2) and tracks metadata. All data
structures are immutable.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from dataclasses import dataclass

from loguru import logger

from agent.artifacts.storage import LocalStorageBackend, StorageBackend
from agent.sandbox.base import SandboxSession


@dataclass(frozen=True)
class Artifact:
    """Immutable metadata for a file extracted from a sandbox.

    Attributes:
        id: Unique identifier for this artifact.
        path: Relative path / storage key for the artifact.
        original_name: Original filename from the sandbox.
        content_type: MIME type or generic type label.
        size: File size in bytes.
        source_agent_id: ID of the agent that produced the artifact.
    """

    id: str
    path: str
    original_name: str
    content_type: str
    size: int
    source_agent_id: str | None = None


# ---------------------------------------------------------------------------
# Content-type inference (pure function)
# ---------------------------------------------------------------------------

_EXTENSION_CONTENT_TYPES: dict[str, str] = {
    ".py": "text/x-python",
    ".js": "text/javascript",
    ".ts": "text/typescript",
    ".json": "application/json",
    ".csv": "text/csv",
    ".html": "text/html",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def _infer_content_type(path: str) -> str:
    """Infer a content type from the file extension."""
    _, ext = os.path.splitext(path)
    return _EXTENSION_CONTENT_TYPES.get(ext.lower(), "application/octet-stream")


# ---------------------------------------------------------------------------
# ArtifactManager
# ---------------------------------------------------------------------------


class ArtifactManager:
    """Manages extraction and storage of sandbox artifacts.

    Downloads files from sandbox sessions to storage and provides
    metadata access.  Accepts a ``StorageBackend`` to abstract the
    storage layer (local filesystem or Cloudflare R2).
    """

    def __init__(
        self,
        storage_dir: str = "./artifacts",
        storage_backend: StorageBackend | None = None,
    ) -> None:
        self._storage_dir = storage_dir
        self._backend: StorageBackend = (
            storage_backend
            if storage_backend is not None
            else LocalStorageBackend(storage_dir=storage_dir)
        )
        self._artifacts: dict[str, Artifact] = {}
        self._lock = asyncio.Lock()

    @property
    def backend(self) -> StorageBackend:
        """Return the underlying storage backend."""
        return self._backend

    async def extract_from_sandbox(
        self,
        session: SandboxSession,
        remote_paths: list[str],
        agent_id: str | None = None,
    ) -> tuple[Artifact, ...]:
        """Download files from *session* and return artifact metadata.

        Args:
            session: An active sandbox session.
            remote_paths: List of file paths inside the sandbox.
            agent_id: Optional ID of the agent that produced the files.

        Returns:
            A tuple of ``Artifact`` objects for successfully downloaded files.
        """
        artifacts: list[Artifact] = []

        for remote_path in remote_paths:
            artifact = await self._extract_single(
                session,
                remote_path,
                agent_id,
            )
            if artifact is not None:
                artifacts.append(artifact)

        return tuple(artifacts)

    async def register_local_artifact(
        self,
        data: bytes,
        filename: str,
        agent_id: str | None = None,
    ) -> Artifact:
        """Register raw bytes as an artifact (for local tools).

        Args:
            data: Raw file bytes.
            filename: Original filename (used for extension / MIME inference).
            agent_id: Optional ID of the agent that produced the artifact.

        Returns:
            An ``Artifact`` with metadata about the stored file.
        """
        artifact_id = uuid.uuid4().hex
        _, ext = os.path.splitext(filename)
        safe_name = f"{artifact_id}{ext}"
        content_type = _infer_content_type(filename)

        await self._backend.save(safe_name, data, content_type)

        artifact = Artifact(
            id=artifact_id,
            path=safe_name,
            original_name=filename,
            content_type=content_type,
            size=len(data),
            source_agent_id=agent_id,
        )
        async with self._lock:
            self._artifacts[artifact_id] = artifact

        logger.info("artifact_registered name={} id={}", filename, artifact_id)
        return artifact

    def list_artifacts(self) -> tuple[Artifact, ...]:
        """Return all artifacts registered in the in-memory registry."""
        return tuple(self._artifacts.values())

    def get_artifact(self, artifact_id: str) -> Artifact | None:
        """Look up an artifact by its unique ID."""
        return self._artifacts.get(artifact_id)

    async def get_url(self, artifact: Artifact) -> str:
        """Return a URL (or local path) for serving the artifact."""
        return await self._backend.get_url(
            artifact.path, artifact.content_type, artifact.original_name
        )

    def get_path(self, artifact: Artifact) -> str:
        """Return the full local filesystem path for *artifact*.

        Only works with ``LocalStorageBackend``. Raises ``RuntimeError``
        if a non-local backend is in use.
        """
        if not isinstance(self._backend, LocalStorageBackend):
            raise RuntimeError(
                "get_path() is only supported with LocalStorageBackend. "
                "Use get_url() for remote backends."
            )
        storage_real = os.path.realpath(self._storage_dir)
        candidate = os.path.realpath(os.path.join(self._storage_dir, artifact.path))
        if not candidate.startswith(storage_real + os.sep):
            raise ValueError(f"Artifact path escapes storage dir: {artifact.path}")
        return candidate

    async def _extract_single(
        self,
        session: SandboxSession,
        remote_path: str,
        agent_id: str | None,
    ) -> Artifact | None:
        """Download a single file, returning its Artifact or None on error."""
        original_name = os.path.basename(remote_path)
        if not original_name:
            logger.warning("Skipping empty filename from path: {}", remote_path)
            return None

        artifact_id = uuid.uuid4().hex
        _, ext = os.path.splitext(original_name)
        safe_name = f"{artifact_id}{ext}"
        content_type = _infer_content_type(original_name)

        # Download to a temp location first, then push to storage backend
        temp_dir = self._storage_dir
        os.makedirs(temp_dir, exist_ok=True)
        temp_path = os.path.join(temp_dir, f"_tmp_{safe_name}")

        try:
            await session.download_file(remote_path, temp_path)
        except FileNotFoundError:
            logger.warning("Remote file not found: {}", remote_path)
            return None
        except Exception as exc:
            logger.exception("Failed to download '{}': {}", remote_path, exc)
            return None

        try:
            with open(temp_path, "rb") as f:
                data = f.read()

            await self._backend.save(safe_name, data, content_type)
        finally:
            # Clean up temp file (may already be the final file for local backend)
            if os.path.isfile(temp_path) and not isinstance(
                self._backend, LocalStorageBackend
            ):
                os.remove(temp_path)

        size = len(data)
        artifact = Artifact(
            id=artifact_id,
            path=safe_name,
            original_name=original_name,
            content_type=content_type,
            size=size,
            source_agent_id=agent_id,
        )
        async with self._lock:
            self._artifacts[artifact_id] = artifact
        return artifact
