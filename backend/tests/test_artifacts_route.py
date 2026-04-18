from __future__ import annotations

from types import SimpleNamespace

import pytest

from agent.state.repository import ConversationRepository
from api.routes.artifacts import list_conversation_artifacts


@pytest.mark.asyncio
async def test_list_conversation_artifacts_returns_persisted_artifacts(session) -> None:
    repo = ConversationRepository()
    convo = await repo.create_conversation(session, title="Artifact route test")
    artifact_id = "a" * 32
    await repo.save_artifact(
        session,
        artifact_id=artifact_id,
        conversation_id=convo.id,
        storage_key=f"{artifact_id}.docx",
        original_name="report.docx",
        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size=15991,
        file_path="/workspace/report.docx",
    )

    payload = await list_conversation_artifacts(
        conversation_id=str(convo.id),
        session=session,
        state=SimpleNamespace(db_repo=repo),
        auth_user=None,
    )

    assert len(payload["artifacts"]) == 1
    assert payload["artifacts"][0]["id"] == artifact_id
    assert payload["artifacts"][0]["name"] == "report.docx"
    assert payload["artifacts"][0]["content_type"] == (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert payload["artifacts"][0]["file_path"] == "/workspace/report.docx"
