"""Tests for BoxLite upload robustness."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import types
from typing import Any
from unittest.mock import AsyncMock

import pytest

from agent.sandbox.base import ExecResult


@pytest.fixture
def boxlite_provider_module(monkeypatch: pytest.MonkeyPatch) -> Any:
    fake_boxlite = types.SimpleNamespace(
        SimpleBox=object,
        TimeoutError=RuntimeError,
        BoxliteError=RuntimeError,
    )
    monkeypatch.setitem(sys.modules, "boxlite", fake_boxlite)
    sys.modules.pop("agent.sandbox.boxlite_provider", None)
    module = importlib.import_module("agent.sandbox.boxlite_provider")
    yield module
    sys.modules.pop("agent.sandbox.boxlite_provider", None)


def _build_exec(existing: set[str], *, fail_decode: bool = False):
    staged: dict[str, str] = {}

    async def _exec(
        command: str,
        timeout: int | None = None,
        workdir: str | None = None,
    ) -> ExecResult:
        import shlex

        parts = shlex.split(command)
        if not parts:
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[:2] == ["mkdir", "-p"]:
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[:2] == ["test", "-f"]:
            path = parts[2]
            return ExecResult(
                stdout="",
                stderr="",
                exit_code=0 if path in existing else 1,
            )
        if parts[0] == "mv":
            src, dst = parts[1], parts[2]
            if src in existing:
                existing.remove(src)
            existing.add(dst)
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[:2] == ["rm", "-f"]:
            staged.pop(parts[2], None)
            return ExecResult(stdout="", stderr="", exit_code=0)
        if parts[0] == "printf":
            staged[parts[-1]] = staged.get(parts[-1], "") + parts[2]
            return ExecResult(stdout="", stderr="", exit_code=0)
        if command.startswith("base64 -d "):
            first = command.split("&&", 1)[0]
            decode_parts = shlex.split(first)
            remote_path = decode_parts[-1]
            if not fail_decode:
                existing.add(remote_path)
            return ExecResult(stdout="", stderr="", exit_code=0)
        return ExecResult(stdout="", stderr="", exit_code=0)

    return _exec


class _FakeBox:
    def __init__(self, copy_in_impl) -> None:
        self._copy_in_impl = copy_in_impl

    async def copy_in(self, local_path: str, dir_path: str) -> None:
        await self._copy_in_impl(local_path, dir_path)


@pytest.mark.asyncio
async def test_exec_exports_configured_env_vars(
    boxlite_provider_module: Any,
) -> None:
    box = types.SimpleNamespace(
        exec=AsyncMock(
            return_value=types.SimpleNamespace(stdout="ok", stderr="", exit_code=0)
        )
    )
    session = boxlite_provider_module.BoxliteSession(
        box,
        env_vars=(("API_TOKEN", "secret value"),),
    )

    await session.exec('printf %s "$API_TOKEN"')

    args = box.exec.await_args.args
    assert args[:2] == ("sh", "-c")
    assert "export API_TOKEN='secret value' &&" in args[2]
    assert 'printf %s "$API_TOKEN"' in args[2]


@pytest.mark.asyncio
async def test_upload_file_succeeds_when_copy_in_works(
    boxlite_provider_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    existing: set[str] = set()

    async def _copy_in(local_path: str, dir_path: str) -> None:
        existing.add(os.path.join(dir_path, os.path.basename(local_path)))

    session = boxlite_provider_module.BoxliteSession(_FakeBox(_copy_in))
    monkeypatch.setattr(session, "exec", _build_exec(existing))

    with tempfile.NamedTemporaryFile(delete=False) as fh:
        fh.write(b"hello")
        local_path = fh.name

    try:
        remote_path = "/home/user/uploads/data.csv"
        await session.upload_file(local_path, remote_path)
        assert remote_path in existing
    finally:
        os.unlink(local_path)


@pytest.mark.asyncio
async def test_upload_file_falls_back_when_copy_in_is_silent(
    boxlite_provider_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    existing: set[str] = set()

    async def _copy_in(local_path: str, dir_path: str) -> None:
        return None

    session = boxlite_provider_module.BoxliteSession(_FakeBox(_copy_in))
    monkeypatch.setattr(session, "exec", _build_exec(existing))

    with tempfile.NamedTemporaryFile(delete=False) as fh:
        fh.write(b"fallback")
        local_path = fh.name

    try:
        remote_path = "/home/user/uploads/fallback.bin"
        await session.upload_file(local_path, remote_path)
        assert remote_path in existing
    finally:
        os.unlink(local_path)


@pytest.mark.asyncio
async def test_upload_file_raises_when_final_verification_fails(
    boxlite_provider_module: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    existing: set[str] = set()

    async def _copy_in(local_path: str, dir_path: str) -> None:
        return None

    session = boxlite_provider_module.BoxliteSession(_FakeBox(_copy_in))
    monkeypatch.setattr(session, "exec", _build_exec(existing, fail_decode=True))

    with tempfile.NamedTemporaryFile(delete=False) as fh:
        fh.write(b"broken")
        local_path = fh.name

    try:
        with pytest.raises(OSError, match="did not appear"):
            await session.upload_file(local_path, "/home/user/uploads/missing.bin")
    finally:
        os.unlink(local_path)
