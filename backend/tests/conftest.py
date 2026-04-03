"""Shared test configuration and fixtures."""

import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from agent.state.models import Base

# Use SQLite for fast, reliable tests without external dependencies
# Use a file-based database with a fixed URI to ensure persistence across connections
# The test isolation is handled by transactions
TEST_DB_URL = "sqlite+aiosqlite:///./test.db"


@pytest_asyncio.fixture
async def session():
    """Isolated session with created tables.

    Uses a file-based SQLite database to ensure tables persist
    across the connection used for setup and the connection used for tests.
    Test isolation is achieved via transaction rollback.
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

    # Now create a session with transaction for test isolation
    async with engine.connect() as conn:
        # Begin outer transaction that will be rolled back after test
        txn = await conn.begin()

        # Create session bound to this connection
        sess_factory = async_sessionmaker(bind=conn, expire_on_commit=False)
        sess = sess_factory()

        # Use savepoint for additional isolation within the test
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

    # Clean up test database file
    import os

    try:
        os.remove("./test.db")
    except FileNotFoundError:
        pass
