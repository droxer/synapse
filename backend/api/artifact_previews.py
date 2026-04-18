"""Server-side artifact preview helpers for PPT/PPTX files."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import httpx

from agent.artifacts.storage import StorageBackend
from agent.state.schemas import ArtifactRecord


def is_ppt_previewable(content_type: str, filename: str) -> bool:
    normalized = content_type.lower()
    if "presentationml" in normalized or normalized == "application/vnd.ms-powerpoint":
        return True

    ext = Path(filename).suffix.lower()
    return ext in {".ppt", ".pptx"}


def _slide_sort_key(path: Path) -> tuple[int, str]:
    name = path.stem
    suffix = name.rsplit("-", 1)[-1]
    if suffix.isdigit():
        return (int(suffix), name)
    return (0, name)


class ArtifactPreviewError(RuntimeError):
    """Raised when preview generation fails."""


class UnsupportedArtifactPreviewError(ArtifactPreviewError):
    """Raised when an artifact type cannot be previewed."""


class PreviewSlideNotFoundError(ArtifactPreviewError):
    """Raised when a rendered slide image is missing."""


@dataclass(frozen=True)
class PptPreviewManifest:
    """Cached PPT preview metadata."""

    kind: str
    file_name: str
    slide_count: int
    slide_paths: tuple[str, ...]


class ArtifactPreviewCache:
    """Generates and caches image previews for PPT/PPTX artifacts."""

    def __init__(self, cache_dir: str | Path | None = None) -> None:
        base_dir = cache_dir or os.path.join(
            tempfile.gettempdir(), "synapse-artifact-preview-cache"
        )
        self._cache_dir = Path(base_dir)
        self._locks: dict[str, asyncio.Lock] = {}

    async def ensure_ppt_preview(
        self,
        artifact: ArtifactRecord,
        storage_backend: StorageBackend,
    ) -> PptPreviewManifest:
        if not is_ppt_previewable(artifact.content_type, artifact.original_name):
            raise UnsupportedArtifactPreviewError(
                f"Artifact type is not previewable: {artifact.content_type}"
            )

        artifact_dir = self._artifact_cache_dir(artifact)
        manifest_path = artifact_dir / "manifest.json"
        cached = self._read_manifest(manifest_path)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(artifact.id, asyncio.Lock())
        async with lock:
            cached = self._read_manifest(manifest_path)
            if cached is not None:
                return cached

            await asyncio.to_thread(artifact_dir.mkdir, parents=True, exist_ok=True)
            await self._render_preview(artifact, storage_backend, artifact_dir)
            manifest = self._read_manifest(manifest_path)
            if manifest is None:
                raise ArtifactPreviewError("Preview manifest was not generated")
            await self._cleanup_stale_cache_dirs(artifact, artifact_dir)
            return manifest

    async def get_slide_path(
        self,
        artifact: ArtifactRecord,
        storage_backend: StorageBackend,
        slide_index: int,
    ) -> Path:
        manifest = await self.ensure_ppt_preview(artifact, storage_backend)
        if slide_index < 1 or slide_index > manifest.slide_count:
            raise PreviewSlideNotFoundError(f"Unknown slide index: {slide_index}")

        slide_path = Path(manifest.slide_paths[slide_index - 1])
        if not slide_path.is_file():
            raise PreviewSlideNotFoundError(f"Missing slide image: {slide_index}")
        return slide_path

    async def _render_preview(
        self,
        artifact: ArtifactRecord,
        storage_backend: StorageBackend,
        artifact_dir: Path,
    ) -> None:
        work_dir = artifact_dir / "work"
        slides_dir = artifact_dir / "slides"
        await asyncio.to_thread(work_dir.mkdir, parents=True, exist_ok=True)
        await asyncio.to_thread(slides_dir.mkdir, parents=True, exist_ok=True)

        source_path = await self._materialize_source(
            artifact, storage_backend, work_dir
        )
        pdf_path = await self._convert_to_pdf(source_path, work_dir)
        slide_paths = await self._render_pdf_to_pngs(pdf_path, slides_dir)
        if not slide_paths:
            raise ArtifactPreviewError("No slides were rendered from presentation")

        manifest = {
            "kind": "slides",
            "file_name": artifact.original_name,
            "slide_count": len(slide_paths),
            "slide_paths": [str(path) for path in slide_paths],
        }
        manifest_path = artifact_dir / "manifest.json"
        await asyncio.to_thread(manifest_path.write_text, json.dumps(manifest), "utf-8")
        await asyncio.to_thread(shutil.rmtree, work_dir, True)

    async def _materialize_source(
        self,
        artifact: ArtifactRecord,
        storage_backend: StorageBackend,
        work_dir: Path,
    ) -> Path:
        resolved = await storage_backend.get_url(
            artifact.storage_key, artifact.content_type, artifact.original_name
        )
        suffix = (
            Path(artifact.original_name).suffix or Path(artifact.storage_key).suffix
        )
        target_path = work_dir / f"source{suffix or '.pptx'}"

        if os.path.isfile(resolved):
            await asyncio.to_thread(shutil.copyfile, resolved, target_path)
            return target_path

        async with httpx.AsyncClient(follow_redirects=True, timeout=60) as client:
            response = await client.get(resolved)
            response.raise_for_status()
            await asyncio.to_thread(target_path.write_bytes, response.content)
        return target_path

    async def _convert_to_pdf(self, source_path: Path, work_dir: Path) -> Path:
        proc = await asyncio.create_subprocess_exec(
            "soffice",
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            str(work_dir),
            str(source_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise ArtifactPreviewError(
                "Failed to convert presentation to PDF: "
                f"{stderr.decode().strip() or stdout.decode().strip()}"
            )

        pdf_path = work_dir / f"{source_path.stem}.pdf"
        if not pdf_path.is_file():
            raise ArtifactPreviewError("Presentation conversion did not produce a PDF")
        return pdf_path

    async def _render_pdf_to_pngs(self, pdf_path: Path, slides_dir: Path) -> list[Path]:
        prefix = slides_dir / "slide"
        proc = await asyncio.create_subprocess_exec(
            "pdftoppm",
            "-png",
            str(pdf_path),
            str(prefix),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            raise ArtifactPreviewError(
                "Failed to render PDF slides: "
                f"{stderr.decode().strip() or stdout.decode().strip()}"
            )

        slide_paths = sorted(slides_dir.glob("slide-*.png"), key=_slide_sort_key)
        return slide_paths

    def _artifact_cache_dir(self, artifact: ArtifactRecord) -> Path:
        fingerprint = hashlib.sha256(
            (
                f"{artifact.storage_key}|{artifact.size}|"
                f"{artifact.created_at.isoformat()}|{artifact.original_name}"
            ).encode("utf-8")
        ).hexdigest()[:16]
        return self._cache_dir / artifact.id / fingerprint

    async def _cleanup_stale_cache_dirs(
        self, artifact: ArtifactRecord, active_dir: Path
    ) -> None:
        parent = active_dir.parent
        if not parent.exists():
            return
        for child in parent.iterdir():
            if child == active_dir or not child.is_dir():
                continue
            await asyncio.to_thread(shutil.rmtree, child, True)

    def _read_manifest(self, manifest_path: Path) -> PptPreviewManifest | None:
        if not manifest_path.is_file():
            return None
        try:
            raw = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

        slide_paths = tuple(raw.get("slide_paths", []))
        if not slide_paths or any(not Path(path).is_file() for path in slide_paths):
            return None

        slide_count = int(raw.get("slide_count", 0))
        if slide_count != len(slide_paths):
            return None

        return PptPreviewManifest(
            kind=str(raw.get("kind", "slides")),
            file_name=str(raw.get("file_name", "")),
            slide_count=slide_count,
            slide_paths=slide_paths,
        )


artifact_preview_cache = ArtifactPreviewCache()
