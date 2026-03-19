"""Storage backend abstraction for artifacts.

Provides a ``StorageBackend`` protocol and two implementations:
- ``LocalStorageBackend``: saves to the local filesystem (default).
- ``R2StorageBackend``: uploads to Cloudflare R2 (S3-compatible).

The factory ``create_storage_backend`` selects the right backend
based on the application settings.
"""

from __future__ import annotations

import asyncio
import os
from typing import Protocol

import boto3
from botocore.config import Config as BotoConfig
from loguru import logger


class StorageBackend(Protocol):
    """Protocol for artifact storage backends."""

    async def save(self, key: str, data: bytes, content_type: str) -> str:
        """Persist *data* under *key* and return a retrieval identifier."""
        ...

    async def get_url(
        self, key: str, content_type: str, filename: str
    ) -> str:
        """Return a URL (or file path) for retrieving the artifact."""
        ...

    async def delete(self, key: str) -> None:
        """Remove the artifact identified by *key*."""
        ...

    async def exists(self, key: str) -> bool:
        """Return ``True`` if *key* exists in the backend."""
        ...


# ---------------------------------------------------------------------------
# Local filesystem backend
# ---------------------------------------------------------------------------


class LocalStorageBackend:
    """Stores artifacts on the local filesystem.

    This is the default backend when no R2 credentials are configured.
    """

    def __init__(self, storage_dir: str = "./artifacts") -> None:
        self._storage_dir = storage_dir

    def _resolve_and_validate(self, key: str) -> str:
        """Resolve the full path for *key* and validate against traversal."""
        file_path = os.path.join(self._storage_dir, key)
        storage_real = os.path.realpath(self._storage_dir)
        file_real = os.path.realpath(file_path)
        if not file_real.startswith(storage_real + os.sep):
            raise ValueError(f"Path traversal attempt blocked: {key}")
        return file_real

    def _sync_save(self, file_real: str, data: bytes) -> None:
        os.makedirs(self._storage_dir, exist_ok=True)
        with open(file_real, "wb") as f:
            f.write(data)

    async def save(self, key: str, data: bytes, content_type: str) -> str:
        file_real = self._resolve_and_validate(key)
        await asyncio.to_thread(self._sync_save, file_real, data)
        logger.debug("local_storage_saved key={} size={}", key, len(data))
        return key

    async def get_url(
        self, key: str, content_type: str, filename: str
    ) -> str:
        """Return the local file path for the artifact."""
        storage_real = os.path.realpath(self._storage_dir)
        candidate = os.path.realpath(os.path.join(self._storage_dir, key))
        if not candidate.startswith(storage_real + os.sep):
            raise ValueError(f"Artifact path escapes storage dir: {key}")
        return candidate

    def _sync_delete(self, file_real: str) -> bool:
        if os.path.isfile(file_real):
            os.remove(file_real)
            return True
        return False

    async def delete(self, key: str) -> None:
        file_real = self._resolve_and_validate(key)
        deleted = await asyncio.to_thread(self._sync_delete, file_real)
        if deleted:
            logger.debug("local_storage_deleted key={}", key)

    def _sync_exists(self, key: str) -> bool:
        file_path = os.path.join(self._storage_dir, key)
        storage_real = os.path.realpath(self._storage_dir)
        file_real = os.path.realpath(file_path)
        if not file_real.startswith(storage_real + os.sep):
            return False
        return os.path.isfile(file_real)

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._sync_exists, key)


# ---------------------------------------------------------------------------
# Cloudflare R2 backend
# ---------------------------------------------------------------------------

# Presigned URL expiration in seconds (1 hour)
_PRESIGNED_URL_EXPIRY = 3600


class R2StorageBackend:
    """Stores artifacts in Cloudflare R2 (S3-compatible object storage).

    Uses ``boto3`` with a custom endpoint URL targeting the R2 API.
    """

    def __init__(
        self,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        bucket_name: str,
        public_url: str = "",
    ) -> None:
        self._bucket_name = bucket_name
        self._public_url = public_url.rstrip("/") if public_url else ""
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            config=BotoConfig(
                region_name="auto",
                retries={"max_attempts": 3, "mode": "standard"},
            ),
        )
        logger.info(
            "r2_storage_initialized bucket=%s public_url=%s",
            bucket_name,
            self._public_url or "(presigned)",
        )

    def _sync_put_object(self, key: str, data: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self._bucket_name,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def save(self, key: str, data: bytes, content_type: str) -> str:
        await asyncio.to_thread(self._sync_put_object, key, data, content_type)
        logger.debug("r2_storage_saved key={} size={}", key, len(data))
        return key

    def _sync_generate_presigned_url(
        self, key: str, content_type: str, filename: str
    ) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self._bucket_name,
                "Key": key,
                "ResponseContentType": content_type,
                "ResponseContentDisposition": f'inline; filename="{filename}"',
            },
            ExpiresIn=_PRESIGNED_URL_EXPIRY,
        )

    async def get_url(
        self, key: str, content_type: str, filename: str
    ) -> str:
        """Return a public URL or a presigned URL for the artifact."""
        if self._public_url:
            return f"{self._public_url}/{key}"

        return await asyncio.to_thread(
            self._sync_generate_presigned_url, key, content_type, filename
        )

    def _sync_delete_object(self, key: str) -> None:
        self._client.delete_object(
            Bucket=self._bucket_name,
            Key=key,
        )

    async def delete(self, key: str) -> None:
        await asyncio.to_thread(self._sync_delete_object, key)
        logger.debug("r2_storage_deleted key={}", key)

    def _sync_head_object(self, key: str) -> bool:
        try:
            self._client.head_object(
                Bucket=self._bucket_name,
                Key=key,
            )
            return True
        except self._client.exceptions.ClientError:
            return False

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._sync_head_object, key)


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


def create_storage_backend(settings: object) -> StorageBackend:
    """Create the appropriate storage backend based on *settings*.

    Reads ``STORAGE_PROVIDER`` to decide the backend:
    - ``"local"`` (default) — local filesystem.
    - ``"r2"`` — Cloudflare R2 (requires R2_* fields).

    Raises ``RuntimeError`` when ``r2`` is selected but credentials
    are missing.
    """
    provider = getattr(settings, "STORAGE_PROVIDER", "local")

    if provider == "local":
        storage_dir = getattr(settings, "STORAGE_DIR", "./artifacts")
        logger.info("storage_provider=local dir={}", storage_dir)
        return LocalStorageBackend(storage_dir=storage_dir)

    if provider == "r2":
        account_id = getattr(settings, "R2_ACCOUNT_ID", "")
        access_key = getattr(settings, "R2_ACCESS_KEY_ID", "")
        secret_key = getattr(settings, "R2_SECRET_ACCESS_KEY", "")
        bucket = getattr(settings, "R2_BUCKET_NAME", "")

        if not all([account_id, access_key, secret_key, bucket]):
            raise RuntimeError(
                "STORAGE_PROVIDER=r2 but one or more required R2 settings "
                "are missing: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
                "R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
            )

        public_url = getattr(settings, "R2_PUBLIC_URL", "")
        return R2StorageBackend(
            account_id=account_id,
            access_key_id=access_key,
            secret_access_key=secret_key,
            bucket_name=bucket,
            public_url=public_url,
        )

    raise ValueError(
        f"Unknown STORAGE_PROVIDER={provider!r}. Must be 'local' or 'r2'."
    )
