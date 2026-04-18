"""FastAPI dependency injection for shared application state."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from agent.state.database import get_session

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

    from agent.artifacts.storage import StorageBackend
    from agent.llm.client import AnthropicClient
    from agent.skills.installer import SkillInstaller
    from agent.skills.loader import SkillRegistry
    from agent.state.repository import (
        ConversationRepository,
        SkillRepository,
        UserPromptRepository,
        UsageRepository,
        UserRepository,
    )
    from api.db_subscriber import PendingWrites
    from api.models import ConversationEntry, MCPState
    from api.user_responses import UserResponseCoordinator


@dataclass
class AppState:
    """Holds all shared state currently captured via closures in the app factory."""

    claude_client: AnthropicClient
    sandbox_provider: Any  # SandboxProvider
    storage_backend: StorageBackend
    db_engine: AsyncEngine
    db_session_factory: async_sessionmaker[AsyncSession]
    db_repo: ConversationRepository
    user_prompt_repo: UserPromptRepository
    user_repo: UserRepository
    db_pending_writes: PendingWrites
    conversations: dict[str, ConversationEntry] = field(default_factory=dict)
    mcp_state: MCPState | None = None
    sandbox_pool: Any = None  # Optional E2B pool
    skill_registry: SkillRegistry | None = None
    skill_installer: SkillInstaller | None = None
    skill_repo: SkillRepository | None = None
    usage_repo: UsageRepository | None = None
    response_coordinator: UserResponseCoordinator | None = None


def get_app_state(request: Request) -> AppState:
    """Retrieve the shared AppState from the FastAPI app instance."""
    return request.app.state.app_state


async def get_db_session(
    state: AppState = Depends(get_app_state),
) -> AsyncGenerator[AsyncSession, None]:
    """Yield an async DB session from the shared session factory."""
    async for session in get_session(state.db_session_factory):
        yield session
