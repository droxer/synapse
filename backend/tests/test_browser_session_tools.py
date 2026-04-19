from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock

import pytest

from agent.tools.sandbox import browser_session_tools


def _state(**overrides: Any) -> dict[str, Any]:
    state: dict[str, Any] = {
        "url": "https://example.com",
        "title": "Example",
        "elements": [
            {
                "index": 0,
                "tag": "button",
                "text": "Continue",
                "attributes": {},
                "visible": True,
            }
        ],
        "scroll_y": 0,
        "page_height": 200,
    }
    state.update(overrides)
    return state


@pytest.mark.asyncio
async def test_browser_session_save_returns_saved_artifact_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mocked = AsyncMock(
        return_value={"success": True, "path": "/workspace/session.json"}
    )
    monkeypatch.setattr(browser_session_tools, "send_browser_command", mocked)

    session = object()
    result = await browser_session_tools.BrowserSessionSave().execute(
        session,
        path="/workspace/session.json",
    )

    assert result.success
    assert result.metadata == {
        "path": "/workspace/session.json",
        "artifact_paths": ["/workspace/session.json"],
    }
    mocked.assert_awaited_once_with(
        session,
        {"action": "save_session", "path": "/workspace/session.json"},
        timeout=20,
    )


@pytest.mark.asyncio
async def test_browser_session_load_formats_state_and_screenshot_artifact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mocked = AsyncMock(
        return_value={
            "success": True,
            "state": _state(screenshot_path="/tmp/browser-shot.png"),
        }
    )
    monkeypatch.setattr(browser_session_tools, "send_browser_command", mocked)

    result = await browser_session_tools.BrowserSessionLoad().execute(
        object(),
        path="/workspace/session.json",
        url="https://example.com",
    )

    assert result.success
    assert "URL: https://example.com" in result.output
    assert result.metadata == {
        "path": "/workspace/session.json",
        "url": "https://example.com",
        "title": "Example",
        "artifact_paths": ["/tmp/browser-shot.png"],
    }


@pytest.mark.asyncio
async def test_browser_downloads_and_upload_use_session_driver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mocked = AsyncMock(
        side_effect=[
            {
                "success": True,
                "downloads": [
                    {
                        "name": "report.pdf",
                        "path": "/home/user/.browser_session/downloads/report.pdf",
                        "size": 128,
                    }
                ],
            },
            {
                "success": True,
                "state": _state(screenshot_path="/tmp/upload.png"),
            },
        ]
    )
    monkeypatch.setattr(browser_session_tools, "send_browser_command", mocked)

    session = object()
    downloads = await browser_session_tools.BrowserDownloads().execute(session)
    upload = await browser_session_tools.BrowserUpload().execute(
        session,
        index=2,
        path="/workspace/report.pdf",
    )

    assert downloads.success
    assert "report.pdf (128 bytes)" in downloads.output
    assert downloads.metadata == {
        "download_count": 1,
        "artifact_paths": ["/home/user/.browser_session/downloads/report.pdf"],
    }

    assert upload.success
    assert "Continue" in upload.output
    assert upload.metadata == {
        "uploaded_paths": ["/workspace/report.pdf"],
        "url": "https://example.com",
        "title": "Example",
        "artifact_paths": ["/tmp/upload.png"],
    }
    assert mocked.await_args_list[1].kwargs == {"timeout": 20}
