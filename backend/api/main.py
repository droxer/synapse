"""FastAPI application factory — wires routers, middleware, and shared state."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from agent.artifacts.storage import create_storage_backend
from agent.llm.client import AnthropicClient
from agent.skills.discovery import SkillDiscoverer
from agent.skills.installer import SkillInstaller
from agent.skills.loader import SkillRegistry
from agent.state.database import get_engine, get_session_factory, init_db
from agent.state.repository import (
    ConversationRepository,
    SkillRepository,
    UserPromptRepository,
    UsageRepository,
    UserRepository,
)
from agent.tools.registry import ToolRegistry
from api.builders import _build_sandbox_provider
from api.db_subscriber import PendingWrites
from api.dependencies import AppState
from api.models import MCPState
from api.user_responses import UserResponseCoordinator
from api.routes import (
    artifacts,
    auth,
    channels,
    conversations,
    health,
    library,
    mcp,
    memory,
    skill_files,
    skills,
    usage,
)
from config.settings import get_settings


def _create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    from agent.logging import setup_logging

    settings = get_settings()
    setup_logging(log_level=settings.LOG_LEVEL)

    # Build sandbox provider once at import time
    sandbox_provider, sandbox_pool = _build_sandbox_provider()

    # Create shared storage backend (local or R2)
    storage_backend = create_storage_backend(settings)

    # Database setup
    db_engine = get_engine(settings.DATABASE_URL)
    db_session_factory = get_session_factory(db_engine)
    db_repo = ConversationRepository()
    user_prompt_repo = UserPromptRepository()
    user_repo = UserRepository()
    db_pending_writes = PendingWrites()

    # Shared AnthropicClient singleton
    claude_client = AnthropicClient(
        api_key=settings.ANTHROPIC_API_KEY,
        default_model=settings.TASK_MODEL,
        base_url=settings.ANTHROPIC_BASE_URL,
    )

    # MCP state container
    mcp_state = MCPState()

    # Discover and register skills
    skill_registry: SkillRegistry | None = None
    skill_installer: SkillInstaller | None = None
    usage_repo = UsageRepository()

    skill_repo: SkillRepository | None = None
    if settings.SKILLS_ENABLED:
        discoverer = SkillDiscoverer(trust_project=settings.SKILLS_TRUST_PROJECT)
        discovered_skills = discoverer.discover_all()
        skill_registry = SkillRegistry(discovered_skills)
        skill_installer = SkillInstaller()
        skill_repo = SkillRepository()
        logger.info("Skills system initialized with {} skills", len(discovered_skills))

    # Build the shared AppState container
    app_state = AppState(
        claude_client=claude_client,
        sandbox_provider=sandbox_provider,
        storage_backend=storage_backend,
        db_engine=db_engine,
        db_session_factory=db_session_factory,
        db_repo=db_repo,
        user_prompt_repo=user_prompt_repo,
        user_repo=user_repo,
        db_pending_writes=db_pending_writes,
        mcp_state=mcp_state,
        sandbox_pool=sandbox_pool,
        skill_registry=skill_registry,
        skill_installer=skill_installer,
        skill_repo=skill_repo,
        usage_repo=usage_repo,
        response_coordinator=UserResponseCoordinator(
            session_factory=db_session_factory,
            prompt_repo=user_prompt_repo,
            conversation_repo=db_repo,
        ),
    )

    @asynccontextmanager
    async def _lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
        # Verify database connectivity (Alembic manages schema)
        await init_db(db_engine)

        # Sync bundled skills to database as shared (user_id=NULL)
        if skill_repo and skill_registry:
            bundled_skills = [
                (
                    s.metadata.name,
                    s.metadata.description,
                    s.source_type,
                    str(s.directory_path),
                )
                for s in skill_registry.all_skills()
                if s.source_type == "bundled"
            ]
            if bundled_skills:
                async with db_session_factory() as session:
                    await skill_repo.sync_shared_skills(session, bundled_skills)
                logger.info(
                    "bundled_skills_synced_to_database count={}", len(bundled_skills)
                )

        # Discover MCP tools from env var
        (
            mcp_state.registry,
            mcp_state.clients,
            mcp_state.configs,
        ) = await mcp._discover_mcp_tools(mcp_state, ToolRegistry())

        # Restore persisted MCP servers from database.
        # Per-user servers are restored lazily when users connect, so we
        # skip the global restore here (env-var servers are already loaded).
        # Individual user servers are restored via _restore_persisted_servers
        # when a conversation is created.

        # Start stale-conversation reaper
        asyncio.create_task(conversations._cleanup_stale_conversations(app_state))

        yield

        # Shut down MCP clients
        for mcp_client in mcp_state.clients.values():
            await mcp_client.close()
        mcp_state.clients = {}
        mcp_state.configs = {}
        mcp_state.registry = None

        # Wait for in-flight DB writes
        logger.info(
            "shutdown_draining_pending_writes count={}", db_pending_writes.count
        )
        await db_pending_writes.wait_drained(timeout=5.0)

        # Drain sandbox pool
        if sandbox_pool is not None:
            logger.info("Draining sandbox pool on shutdown")
            await sandbox_pool.drain()

        # Close shared clients
        await claude_client.close()
        await db_engine.dispose()
        logger.info("database_engine_disposed")

    application = FastAPI(title="Synapse", version="0.1.0", lifespan=_lifespan)

    # Store AppState for dependency injection
    application.state.app_state = app_state

    # CORS
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Include routers (health first for load balancer priority)
    application.include_router(health.router)
    application.include_router(auth.router)
    application.include_router(auth.user_router)
    application.include_router(conversations.router)
    application.include_router(mcp.router)
    application.include_router(artifacts.router)
    application.include_router(skills.router)
    application.include_router(skill_files.router)
    application.include_router(library.router)
    application.include_router(usage.router)
    application.include_router(memory.router)
    application.include_router(channels.router)

    return application


app = _create_app()

if __name__ == "__main__":
    settings = get_settings()
    uvicorn.run(
        "api.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.ENVIRONMENT == "development",
    )
