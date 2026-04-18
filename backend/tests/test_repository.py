"""Integration tests for ConversationRepository.

Uses SQLite for fast, isolated tests.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from agent.state.models import Base
from agent.state.repository import ConversationRepository

from .conftest import TEST_DB_URL


@pytest_asyncio.fixture
async def session():
    """Create an isolated session using a rolled-back transaction.

    Creates tables first, then wraps each test in a transaction that is
    always rolled back, so tests never modify the database.
    """
    import os

    try:
        os.remove("./test.db")
    except FileNotFoundError:
        pass

    engine = create_async_engine(TEST_DB_URL)

    # Create all tables first
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with engine.connect() as conn:
        txn = await conn.begin()
        sess = AsyncSession(bind=conn, expire_on_commit=False)

        # Each time repo code calls session.commit(), restart the
        # SAVEPOINT so subsequent operations still work.
        await conn.begin_nested()

        @event.listens_for(sess.sync_session, "after_transaction_end")
        def _restart_savepoint(session_sync, transaction):
            if conn.closed:
                return
            if not conn.in_nested_transaction():
                conn.sync_connection.begin_nested()

        yield sess

        await sess.close()
        await txn.rollback()
    await engine.dispose()


@pytest.fixture
def repo() -> ConversationRepository:
    return ConversationRepository()


class TestCreateConversation:
    async def test_creates_with_title(self, repo, session: AsyncSession) -> None:
        record = await repo.create_conversation(session, title="Test convo")
        assert record.title == "Test convo"
        assert record.id is not None

    async def test_creates_without_title(self, repo, session: AsyncSession) -> None:
        record = await repo.create_conversation(session, title=None)
        assert record.title is None

    async def test_creates_with_orchestrator_mode(
        self, repo, session: AsyncSession
    ) -> None:
        record = await repo.create_conversation(
            session,
            title="Planner convo",
            orchestrator_mode="planner",
        )
        assert record.orchestrator_mode == "planner"


class TestGetConversation:
    async def test_returns_none_for_missing(self, repo, session: AsyncSession) -> None:
        result = await repo.get_conversation(session, uuid.uuid4())
        assert result is None

    async def test_returns_existing(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Find me")
        found = await repo.get_conversation(session, created.id)
        assert found is not None
        assert found.id == created.id
        assert found.title == "Find me"


class TestListConversations:
    async def test_paginated_list(self, repo, session: AsyncSession) -> None:
        for i in range(5):
            await repo.create_conversation(session, title=f"Convo {i}")
        items, total = await repo.list_conversations(session, limit=2, offset=0)
        assert len(items) == 2
        assert total == 5

    async def test_offset(self, repo, session: AsyncSession) -> None:
        for i in range(3):
            await repo.create_conversation(session, title=f"Convo {i}")
        items, total = await repo.list_conversations(session, limit=10, offset=2)
        assert len(items) == 1
        assert total == 3


class TestUpdateConversation:
    async def test_update_title(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Old")
        updated = await repo.update_conversation(session, created.id, title="New")
        assert updated.title == "New"

    async def test_update_orchestrator_mode(self, repo, session: AsyncSession) -> None:
        created = await repo.create_conversation(session, title="Mode test")
        updated = await repo.update_conversation(
            session,
            created.id,
            orchestrator_mode="planner",
        )
        assert updated.orchestrator_mode == "planner"

    async def test_merge_context_summary_preserves_fragment_boundaries(
        self, repo, session: AsyncSession
    ) -> None:
        convo = await repo.create_conversation(session, title="Summary test")

        await repo.merge_conversation_context_summary(
            session,
            convo.id,
            "## Earlier conversation\n" + "a" * 80,
            max_chars=200,
        )
        await repo.merge_conversation_context_summary(
            session,
            convo.id,
            "## Previous work\n" + "b" * 80,
            max_chars=120,
        )

        updated = await repo.get_conversation(session, convo.id)

        assert updated is not None
        assert updated.context_summary is not None
        assert updated.context_summary.startswith("## ")
        assert "## Previous work" in updated.context_summary


class TestMessages:
    async def test_save_and_get_messages(self, repo, session: AsyncSession) -> None:
        convo = await repo.create_conversation(session, title="Messages test")
        await repo.save_message(
            session, convo.id, role="user", content={"text": "hello"}, iteration=None
        )
        await repo.save_message(
            session,
            convo.id,
            role="assistant",
            content={"text": "hi there"},
            iteration=1,
        )
        messages = await repo.get_messages(session, convo.id)
        assert len(messages) == 2
        assert messages[0].role == "user"
        assert messages[1].role == "assistant"
        assert messages[1].iteration == 1

    async def test_save_and_get_messages_with_attachment_metadata(
        self, repo, session: AsyncSession
    ) -> None:
        convo = await repo.create_conversation(
            session, title="Attachment messages test"
        )
        content = {
            "text": "use this upload",
            "attachments": [
                {"name": "report.csv", "size": 12, "type": "text/csv"},
            ],
        }
        await repo.save_message(
            session, convo.id, role="user", content=content, iteration=None
        )

        messages = await repo.get_messages(session, convo.id)

        assert len(messages) == 1
        assert messages[0].content == content


class TestEvents:
    async def test_save_and_get_events(self, repo, session: AsyncSession) -> None:
        convo = await repo.create_conversation(session, title="Events test")
        await repo.save_event(
            session,
            convo.id,
            event_type="task_start",
            data={"message": "hello"},
            iteration=1,
        )
        events = await repo.get_events(session, convo.id, limit=10, offset=0)
        assert len(events) == 1
        assert events[0].event_type == "task_start"

    async def test_save_event_flushes_before_commit(
        self, repo, session: AsyncSession
    ) -> None:
        """Verify save_event persists correctly with flush+commit pattern."""
        convo = await repo.create_conversation(session, title="Flush test")
        await repo.save_event(
            session,
            convo.id,
            event_type="tool_result",
            data={"output": "42"},
            iteration=2,
        )
        # Re-read from DB to confirm persistence
        events = await repo.get_events(session, convo.id)
        assert len(events) == 1
        assert events[0].data == {"output": "42"}
        assert events[0].iteration == 2


class TestArtifacts:
    async def test_save_artifact_flushes_before_commit(
        self, repo, session: AsyncSession
    ) -> None:
        """Verify save_artifact persists correctly with flush+refresh+commit."""
        convo = await repo.create_conversation(session, title="Artifact flush test")
        artifact_id = uuid.uuid4().hex[:32]
        artifact = await repo.save_artifact(
            session,
            artifact_id=artifact_id,
            conversation_id=convo.id,
            storage_key=f"store/{artifact_id}",
            original_name="image.png",
            content_type="image/png",
            size=1024,
        )
        assert artifact.id == artifact_id
        assert artifact.original_name == "image.png"
        assert artifact.size == 1024

        # Re-read from DB
        fetched = await repo.get_artifact(session, artifact_id)
        assert fetched is not None
        assert fetched.storage_key == f"store/{artifact_id}"

    async def test_list_artifacts_returns_conversation_artifacts_newest_first(
        self, repo, session: AsyncSession
    ) -> None:
        convo = await repo.create_conversation(session, title="Artifact list test")
        older_id = uuid.uuid4().hex[:32]
        newer_id = uuid.uuid4().hex[:32]
        await repo.save_artifact(
            session,
            artifact_id=older_id,
            conversation_id=convo.id,
            storage_key=f"store/{older_id}",
            original_name="older.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size=100,
            file_path="/workspace/older.docx",
        )
        await repo.save_artifact(
            session,
            artifact_id=newer_id,
            conversation_id=convo.id,
            storage_key=f"store/{newer_id}",
            original_name="newer.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size=200,
            file_path="/workspace/newer.docx",
        )

        artifacts = await repo.list_artifacts(session, convo.id)
        assert [artifact.id for artifact in artifacts] == [newer_id, older_id]
        assert artifacts[0].file_path == "/workspace/newer.docx"
