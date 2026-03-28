"""Integration tests for UsageRepository.

Uses SQLite for fast, isolated tests.
"""

import uuid

import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from agent.state.models import Base, ConversationModel, UserModel
from agent.state.repository import UsageRepository

from .conftest import TEST_DB_URL


@pytest_asyncio.fixture
async def session():
    """Isolated session with rolled-back transaction."""
    engine = create_async_engine(TEST_DB_URL)

    # Create all tables first
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with engine.connect() as conn:
        txn = await conn.begin()
        sess = AsyncSession(bind=conn, expire_on_commit=False)

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


@pytest_asyncio.fixture
async def user_id(session: AsyncSession) -> uuid.UUID:
    """Create a test user and return its ID."""
    uid = uuid.uuid4()
    user = UserModel(
        id=uid,
        google_id=f"google_{uid.hex[:8]}",
        email=f"test_{uid.hex[:8]}@example.com",
        name="Test User",
    )
    session.add(user)
    await session.flush()
    return uid


@pytest_asyncio.fixture
async def conversation_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    """Create a test conversation and return its ID."""
    cid = uuid.uuid4()
    conv = ConversationModel(id=cid, user_id=user_id, title="Test Conversation")
    session.add(conv)
    await session.flush()
    return cid


@pytest.fixture
def repo() -> UsageRepository:
    return UsageRepository()


class TestIncrement:
    async def test_creates_row(self, repo, session, conversation_id, user_id) -> None:
        await repo.increment(session, conversation_id, user_id, 100, 50)
        record = await repo.get_conversation_usage(session, conversation_id)

        assert record is not None
        assert record.input_tokens == 100
        assert record.output_tokens == 50
        assert record.request_count == 1

    async def test_accumulates(self, repo, session, conversation_id, user_id) -> None:
        await repo.increment(session, conversation_id, user_id, 100, 50)
        await repo.increment(session, conversation_id, user_id, 200, 75)
        record = await repo.get_conversation_usage(session, conversation_id)

        assert record is not None
        assert record.input_tokens == 300
        assert record.output_tokens == 125
        assert record.request_count == 2


class TestGetConversationUsage:
    async def test_returns_none_for_unknown(self, repo, session) -> None:
        record = await repo.get_conversation_usage(session, uuid.uuid4())
        assert record is None


class TestGetUserUsage:
    async def test_aggregates_across_conversations(
        self, repo, session, user_id
    ) -> None:
        # Create two conversations
        cid1, cid2 = uuid.uuid4(), uuid.uuid4()
        session.add(ConversationModel(id=cid1, user_id=user_id))
        session.add(ConversationModel(id=cid2, user_id=user_id))
        await session.flush()

        await repo.increment(session, cid1, user_id, 100, 50)
        await repo.increment(session, cid2, user_id, 200, 75)

        summary = await repo.get_user_usage(session, user_id)
        assert summary.total_input_tokens == 300
        assert summary.total_output_tokens == 125
        assert summary.total_requests == 2
        assert summary.conversation_count == 2

    async def test_empty_user(self, repo, session, user_id) -> None:
        summary = await repo.get_user_usage(session, user_id)
        assert summary.total_input_tokens == 0
        assert summary.total_output_tokens == 0
        assert summary.total_requests == 0
        assert summary.conversation_count == 0


class TestListConversationUsage:
    async def test_pagination(self, repo, session, user_id) -> None:
        # Create 3 conversations with usage
        cids = [uuid.uuid4() for _ in range(3)]
        for cid in cids:
            session.add(ConversationModel(id=cid, user_id=user_id))
        await session.flush()

        for cid in cids:
            await repo.increment(session, cid, user_id, 100, 50)

        items, total = await repo.list_conversation_usage(
            session, user_id, limit=2, offset=0
        )
        assert total == 3
        assert len(items) == 2

        items2, _ = await repo.list_conversation_usage(
            session, user_id, limit=2, offset=2
        )
        assert len(items2) == 1
