"""Tests for ArtifactManager.register_local_artifact and content type inference."""

from __future__ import annotations

import os

import pytest

from agent.artifacts.manager import ArtifactManager, _infer_content_type


class TestInferContentType:
    def test_png(self):
        assert _infer_content_type("image.png") == "image/png"

    def test_jpg(self):
        assert _infer_content_type("photo.jpg") == "image/jpeg"

    def test_jpeg(self):
        assert _infer_content_type("photo.jpeg") == "image/jpeg"

    def test_gif(self):
        assert _infer_content_type("animation.gif") == "image/gif"

    def test_svg(self):
        assert _infer_content_type("icon.svg") == "image/svg+xml"

    def test_python(self):
        assert _infer_content_type("script.py") == "text/x-python"

    def test_tsv(self):
        assert _infer_content_type("table.tsv") == "text/tab-separated-values"

    def test_doc(self):
        assert _infer_content_type("report.doc") == "application/msword"

    def test_ppt(self):
        assert _infer_content_type("deck.ppt") == "application/vnd.ms-powerpoint"

    def test_unknown_extension(self):
        assert _infer_content_type("file.xyz") == "application/octet-stream"

    def test_no_extension(self):
        assert _infer_content_type("Makefile") == "application/octet-stream"


class TestRegisterLocalArtifact:
    @pytest.mark.asyncio
    async def test_registers_and_stores_bytes(self, tmp_path):
        manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))
        data = b"fake image data"

        artifact = await manager.register_local_artifact(
            data=data, filename="test.png", agent_id="agent-1"
        )

        assert artifact.original_name == "test.png"
        assert artifact.content_type == "image/png"
        assert artifact.size == len(data)
        assert artifact.source_agent_id == "agent-1"

        # Verify file was written
        file_path = manager.get_path(artifact)
        assert os.path.isfile(file_path)
        with open(file_path, "rb") as f:
            assert f.read() == data

    @pytest.mark.asyncio
    async def test_artifact_appears_in_registry(self, tmp_path):
        manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))

        artifact = await manager.register_local_artifact(
            data=b"data", filename="file.jpg"
        )

        assert manager.get_artifact(artifact.id) is artifact
        assert artifact in manager.list_artifacts()

    @pytest.mark.asyncio
    async def test_no_agent_id(self, tmp_path):
        manager = ArtifactManager(storage_dir=str(tmp_path / "artifacts"))

        artifact = await manager.register_local_artifact(
            data=b"data", filename="file.txt"
        )

        assert artifact.source_agent_id is None

    @pytest.mark.asyncio
    async def test_creates_storage_dir(self, tmp_path):
        storage = str(tmp_path / "new" / "dir")
        manager = ArtifactManager(storage_dir=storage)

        await manager.register_local_artifact(data=b"x", filename="a.txt")

        assert os.path.isdir(storage)
