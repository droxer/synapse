from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from agent.artifacts.storage import LocalStorageBackend
from agent.state.repository import ConversationRepository
from api.artifact_previews import (
    ArtifactPreviewCache,
    ArtifactPreviewError,
    _slide_sort_key,
)
from api.routes.artifacts import (
    get_artifact_preview_manifest,
    get_artifact_preview_slide,
)


@pytest.mark.asyncio
async def test_preview_cache_reuses_rendered_slides(tmp_path: Path) -> None:
    storage_dir = tmp_path / "storage"
    storage_dir.mkdir()
    pptx_path = storage_dir / "deck.pptx"
    pptx_path.write_bytes(b"fake-pptx")
    backend = LocalStorageBackend(storage_dir=str(storage_dir))
    cache = ArtifactPreviewCache(cache_dir=tmp_path / "cache")

    artifact = SimpleNamespace(
        id="a" * 32,
        storage_key="deck.pptx",
        original_name="deck.pptx",
        content_type=(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ),
        size=9,
        created_at=SimpleNamespace(isoformat=lambda: "2026-04-18T00:00:00+00:00"),
    )

    calls = {"convert": 0, "render": 0}

    async def fake_convert_to_pdf(source_path: Path, work_dir: Path) -> Path:
        calls["convert"] += 1
        pdf_path = work_dir / f"{source_path.stem}.pdf"
        pdf_path.write_bytes(b"%PDF-1.4")
        return pdf_path

    async def fake_render_pdf_to_pngs(_pdf_path: Path, slides_dir: Path) -> list[Path]:
        calls["render"] += 1
        slides = [slides_dir / "slide-1.png", slides_dir / "slide-2.png"]
        for slide in slides:
            slide.write_bytes(b"png")
        return slides

    cache._convert_to_pdf = fake_convert_to_pdf  # type: ignore[method-assign]
    cache._render_pdf_to_pngs = fake_render_pdf_to_pngs  # type: ignore[method-assign]

    first = await cache.ensure_ppt_preview(artifact, backend)
    second = await cache.ensure_ppt_preview(artifact, backend)

    assert first.slide_count == 2
    assert second.slide_count == 2
    assert calls == {"convert": 1, "render": 1}


def test_slide_sort_key_orders_numeric_suffixes_correctly() -> None:
    slides = [
        Path("/tmp/slide-10.png"),
        Path("/tmp/slide-2.png"),
        Path("/tmp/slide-1.png"),
    ]

    ordered = sorted(slides, key=_slide_sort_key)

    assert [path.name for path in ordered] == [
        "slide-1.png",
        "slide-2.png",
        "slide-10.png",
    ]


@pytest.mark.asyncio
async def test_preview_convert_times_out_and_kills_process(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cache = ArtifactPreviewCache(
        cache_dir=tmp_path / "cache",
        render_timeout_seconds=0.01,
    )
    killed = False

    class _SlowProcess:
        returncode = 0

        async def communicate(self):
            if killed:
                return b"", b""
            await asyncio.sleep(60)
            return b"", b""

        def kill(self) -> None:
            nonlocal killed
            killed = True

    async def _fake_exec(*args, **kwargs):
        del args, kwargs
        return _SlowProcess()

    monkeypatch.setattr(
        "api.artifact_previews.asyncio.create_subprocess_exec", _fake_exec
    )

    with pytest.raises(ArtifactPreviewError, match="Timed out"):
        await cache._convert_to_pdf(tmp_path / "deck.pptx", tmp_path)

    assert killed is True


@pytest.mark.asyncio
async def test_get_artifact_preview_manifest_returns_slide_urls(session) -> None:
    repo = ConversationRepository()
    convo = await repo.create_conversation(session, title="Preview route test")
    artifact_id = "a" * 32
    await repo.save_artifact(
        session,
        artifact_id=artifact_id,
        conversation_id=convo.id,
        storage_key=f"{artifact_id}.pptx",
        original_name="deck.pptx",
        content_type=(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ),
        size=128,
        file_path="/workspace/deck.pptx",
    )

    state = SimpleNamespace(
        db_repo=repo,
        storage_backend=SimpleNamespace(),
    )

    from api.routes import artifacts as artifacts_routes

    async def fake_ensure_preview(record, _storage_backend):
        return SimpleNamespace(
            kind="slides",
            file_name=record.original_name,
            slide_count=2,
            slide_paths=("/tmp/slide-1.png", "/tmp/slide-2.png"),
        )

    original = artifacts_routes.artifact_preview_cache.ensure_ppt_preview
    artifacts_routes.artifact_preview_cache.ensure_ppt_preview = fake_ensure_preview
    try:
        payload = await get_artifact_preview_manifest(
            conversation_id=str(convo.id),
            artifact_id=artifact_id,
            session=session,
            state=state,
            auth_user=None,
        )
    finally:
        artifacts_routes.artifact_preview_cache.ensure_ppt_preview = original

    assert payload == {
        "kind": "slides",
        "file_name": "deck.pptx",
        "slide_count": 2,
        "slides": [
            {
                "index": 1,
                "image_url": (
                    f"/api/conversations/{convo.id}/artifacts/{artifact_id}/preview/slides/1"
                ),
            },
            {
                "index": 2,
                "image_url": (
                    f"/api/conversations/{convo.id}/artifacts/{artifact_id}/preview/slides/2"
                ),
            },
        ],
    }


@pytest.mark.asyncio
async def test_get_artifact_preview_slide_rejects_wrong_conversation(session) -> None:
    repo = ConversationRepository()
    convo = await repo.create_conversation(session, title="Preview route test")
    other = await repo.create_conversation(session, title="Other")
    artifact_id = "b" * 32
    await repo.save_artifact(
        session,
        artifact_id=artifact_id,
        conversation_id=convo.id,
        storage_key=f"{artifact_id}.pptx",
        original_name="deck.pptx",
        content_type=(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        ),
        size=128,
        file_path="/workspace/deck.pptx",
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_artifact_preview_slide(
            conversation_id=str(other.id),
            artifact_id=artifact_id,
            slide_index=1,
            session=session,
            state=SimpleNamespace(db_repo=repo, storage_backend=SimpleNamespace()),
            auth_user=None,
        )

    assert getattr(exc_info.value, "status_code", None) == 404


@pytest.mark.asyncio
async def test_get_artifact_preview_manifest_rejects_non_ppt(session) -> None:
    repo = ConversationRepository()
    convo = await repo.create_conversation(session, title="Preview route test")
    artifact_id = "c" * 32
    await repo.save_artifact(
        session,
        artifact_id=artifact_id,
        conversation_id=convo.id,
        storage_key=f"{artifact_id}.pdf",
        original_name="report.pdf",
        content_type="application/pdf",
        size=128,
        file_path="/workspace/report.pdf",
    )

    with pytest.raises(HTTPException) as exc_info:
        await get_artifact_preview_manifest(
            conversation_id=str(convo.id),
            artifact_id=artifact_id,
            session=session,
            state=SimpleNamespace(db_repo=repo, storage_backend=SimpleNamespace()),
            auth_user=None,
        )

    assert getattr(exc_info.value, "status_code", None) == 415
