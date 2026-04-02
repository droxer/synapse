"""Channel route handlers — per-user Telegram bot setup and webhook ingress."""

from __future__ import annotations

import asyncio
import json
import math
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.exc import IntegrityError

from fastapi import APIRouter, Depends, HTTPException, Request
from loguru import logger
from pydantic import BaseModel, Field

from agent.memory.facts import FactCandidate, validate_fact_candidate
from agent.memory.store import PersistentMemoryStore
from api.auth.middleware import AuthUser, common_dependencies, get_current_user
from api.builders import format_verified_facts_prompt_section
from api.builders import _build_orchestrator
from api.channels.provider import ChannelProvider, TelegramProvider
from api.channels.repository import ChannelRepository
from api.channels.responder import ChannelResponder
from api.channels.router import ChannelRouter
from api.channels.schemas import InboundMessage, TelegramBotConfigRecord
from api.db_subscriber import create_db_subscriber
from api.dependencies import AppState, get_app_state
from api.events import AgentEvent, EventEmitter
from api.models import ConversationEntry, FileAttachment
from api.sse import _create_queue_subscriber
from config.settings import get_settings

router = APIRouter(prefix="/channels", tags=["channels"])

_channel_repo: ChannelRepository | None = None
_channel_router: ChannelRouter | None = None
_EVENT_QUEUE_MAXSIZE = 5000


class LinkTokenRequest(BaseModel):
    provider: str = Field(default="telegram", max_length=20)


class LinkTokenResponse(BaseModel):
    token: str
    provider: str
    expires_in_minutes: int = 10


class TelegramBotConfigRequest(BaseModel):
    bot_token: str = Field(min_length=10, max_length=512)


def _extract_fact_candidates(text: str) -> tuple[FactCandidate, ...]:
    """Extract strict memory fact candidates from a user message."""
    normalized = text.strip()
    if not normalized:
        return ()

    lower = normalized.lower()
    candidates: list[FactCandidate] = []

    if "timezone" in lower and " is " in lower:
        value = normalized.split(" is ", 1)[-1].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="profile",
                    key="profile.timezone",
                    value=value,
                    confidence=0.9,
                    evidence_snippet=normalized[:500],
                )
            )

    if "i prefer" in lower:
        value = normalized[lower.find("i prefer") + len("i prefer") :].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="preferences",
                    key="preferences.general",
                    value=value,
                    confidence=0.88,
                    evidence_snippet=normalized[:500],
                )
            )

    if "my language is" in lower:
        value = normalized[
            lower.find("my language is") + len("my language is") :
        ].strip()
        if value:
            candidates.append(
                FactCandidate(
                    namespace="preferences",
                    key="preferences.language",
                    value=value,
                    confidence=0.92,
                    evidence_snippet=normalized[:500],
                )
            )

    return tuple(candidates)


async def _extract_and_upsert_facts_for_turn(
    *,
    store: PersistentMemoryStore,
    conversation_id: uuid.UUID,
    turn_id: str,
    message_text: str,
    source_chat_id: str,
) -> None:
    """Persist high-confidence strict facts from a completed Telegram turn."""
    seen = await store.mark_fact_ingestion_seen(
        conversation_id=conversation_id,
        turn_id=turn_id,
    )
    if not seen:
        return

    settings = get_settings()
    candidates = _extract_fact_candidates(message_text)
    saved = 0
    rejected = 0
    for candidate in candidates:
        verdict = validate_fact_candidate(
            candidate,
            threshold=settings.MEMORY_FACT_CONFIDENCE_THRESHOLD,
        )
        if not verdict.accepted:
            rejected += 1
            continue

        await store.upsert_fact(
            namespace=candidate.namespace,
            key=candidate.key,
            value=candidate.value,
            confidence=candidate.confidence,
            source="telegram",
            source_chat_id=source_chat_id,
            evidence_snippet=candidate.evidence_snippet,
        )
        saved += 1

    logger.info(
        "memory_fact_extraction_complete conversation_id={} extracted={} saved={} rejected={}",
        conversation_id,
        len(candidates),
        saved,
        rejected,
    )


def _require_channels_enabled() -> None:
    if not get_settings().CHANNELS_ENABLED:
        raise HTTPException(status_code=404, detail="Channels feature not enabled")


def _get_channel_repo() -> ChannelRepository:
    global _channel_repo
    if _channel_repo is None:
        _channel_repo = ChannelRepository()
    return _channel_repo


def _get_channel_router(state: AppState) -> ChannelRouter:
    global _channel_router
    if _channel_router is None:
        _channel_router = ChannelRouter(
            channel_repo=_get_channel_repo(),
            session_factory=state.db_session_factory,
        )
    return _channel_router


def _build_provider(bot_config: TelegramBotConfigRecord) -> TelegramProvider:
    return TelegramProvider(
        bot_token=bot_config.bot_token,
        webhook_secret=bot_config.webhook_secret,
    )


def _mask_token(token: str) -> str:
    if len(token) <= 8:
        return "*" * len(token)
    return f"{token[:4]}...{token[-4:]}"


def _webhook_url_for_request(request: Request) -> str:
    settings = get_settings()
    base = settings.CHANNELS_WEBHOOK_BASE_URL.rstrip("/")
    if not base:
        base = str(request.base_url).rstrip("/")
    return f"{base}/channels/telegram/webhook"


async def _resolve_user_id_or_401(
    state: AppState, auth_user: AuthUser | None
) -> uuid.UUID:
    if auth_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    from api.routes.conversations import _resolve_user_id

    user_id = await _resolve_user_id(auth_user, state)
    if user_id is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user_id


def _serialize_status(
    *,
    settings_enabled: bool,
    bot_config: TelegramBotConfigRecord | None,
    linked: bool,
    display_name: str | None,
) -> dict[str, Any]:
    provider: dict[str, Any] = {
        "configured": bot_config is not None,
        "linked": linked,
        "enabled": bool(bot_config.enabled) if bot_config else False,
        "webhook_status": bot_config.webhook_status if bot_config else "not_configured",
    }
    if bot_config is not None:
        provider["bot_username"] = bot_config.bot_username
        provider["bot_user_id"] = bot_config.bot_user_id
        provider["masked_token"] = _mask_token(bot_config.bot_token)
        provider["last_error"] = bot_config.last_error
    if display_name:
        provider["display_name"] = display_name
    return {"enabled": settings_enabled, "providers": {"telegram": provider}}


@router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    state: AppState = Depends(get_app_state),
) -> dict[str, str]:
    _require_channels_enabled()

    webhook_secret = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not webhook_secret:
        raise HTTPException(status_code=403, detail="Missing webhook secret")

    repo = _get_channel_repo()
    async with state.db_session_factory() as db:
        bot_config = await repo.get_telegram_bot_config_by_webhook_secret(
            db, webhook_secret
        )

    if bot_config is None:
        logger.warning("telegram_webhook_unknown_secret")
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    provider = _build_provider(bot_config)

    body = await request.body()
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc

    message = await provider.parse_inbound(payload)
    if message is None:
        return {"status": "ignored"}

    channel_router = _get_channel_router(state)
    await _handle_channel_message(
        state,
        channel_router,
        provider,
        message,
        bot_config_id=bot_config.id,
    )
    return {"status": "ok"}


async def _handle_channel_message(
    state: AppState,
    channel_router: ChannelRouter,
    provider: ChannelProvider,
    message: InboundMessage,
    *,
    bot_config_id: uuid.UUID,
) -> None:
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        account = await repo.find_account_by_provider(
            db,
            message.provider,
            message.provider_user_id,
            bot_config_id=bot_config_id,
        )

    if message.is_command or account is None:
        await channel_router.handle_inbound(message, provider, bot_config_id)
        return

    async with state.db_session_factory() as db:
        session_record = await repo.find_active_session(db, account.id)

    is_first_turn = False
    if session_record is None:
        is_first_turn = True
        conv_uuid = uuid.uuid4()
        emitter = EventEmitter()
        event_queue: asyncio.Queue[AgentEvent | None] = asyncio.Queue(
            maxsize=_EVENT_QUEUE_MAXSIZE
        )
        pending_callbacks: dict[str, Any] = {}
        subscriber = _create_queue_subscriber(event_queue, pending_callbacks)
        emitter.subscribe(subscriber)

        user_id = account.user_id
        persistent_store = PersistentMemoryStore(
            session_factory=state.db_session_factory,
            user_id=user_id,
            conversation_id=conv_uuid,
        )
        memory_entries = await persistent_store.load_all()

        from api.routes.conversations import (
            _build_user_skill_registry,
            _reconstruct_conversation,
            _run_turn,
        )

        user_skill_registry = await _build_user_skill_registry(state, user_id)
        orchestrator, executor = _build_orchestrator(
            state.claude_client,
            emitter,
            state.sandbox_provider,
            state.storage_backend,
            persistent_store=persistent_store,
            mcp_state=state.mcp_state,
            skill_registry=user_skill_registry,
            memory_entries=memory_entries,
        )

        entry = ConversationEntry(
            emitter=emitter,
            event_queue=event_queue,
            orchestrator=orchestrator,
            executor=executor,
            pending_callbacks=pending_callbacks,
        )
        entry.subscriber = subscriber
        conversation_id_str = str(conv_uuid)
        state.conversations[conversation_id_str] = entry

        async with state.db_session_factory() as db:
            await state.db_repo.create_conversation(
                db,
                title=(message.text or "Telegram chat")[:80],
                conversation_id=conv_uuid,
                user_id=user_id,
            )

        for _attempt in range(10):
            async with state.db_session_factory() as barrier_session:
                if (
                    await state.db_repo.get_conversation(barrier_session, conv_uuid)
                    is not None
                ):
                    break
            await asyncio.sleep(0.05)

        db_sub = create_db_subscriber(
            conv_uuid,
            state.db_repo,
            state.db_session_factory,
            state.db_pending_writes,
            skill_repo=state.skill_repo,
            user_id=user_id,
            usage_repo=state.usage_repo,
        )
        emitter.subscribe(db_sub)

        async with state.db_session_factory() as db:
            session_record = await repo.create_session(
                db,
                channel_account_id=account.id,
                conversation_id=conv_uuid,
                provider=message.provider,
                provider_chat_id=message.provider_chat_id,
                bot_config_id=bot_config_id,
            )

        responder = ChannelResponder(
            provider=provider,
            chat_id=message.provider_chat_id,
            channel_repo=repo,
            session_factory=state.db_session_factory,
            channel_session_id=session_record.id,
            conversation_id=conv_uuid,
            emitter=emitter,
            storage_backend=state.storage_backend,
            on_ask_user=channel_router.register_pending_prompt,
        )
        emitter.subscribe(responder)
    else:
        conv_uuid = session_record.conversation_id
        conversation_id_str = str(conv_uuid)
        entry = state.conversations.get(conversation_id_str)
        if entry is None:
            from api.routes.conversations import _reconstruct_conversation, _run_turn

            entry = await _reconstruct_conversation(state, conversation_id_str)
            if entry is None:
                await provider.send_text(
                    message.provider_chat_id,
                    "Session expired. Use /new to start a fresh conversation.",
                )
                return

        responder = ChannelResponder(
            provider=provider,
            chat_id=message.provider_chat_id,
            channel_repo=repo,
            session_factory=state.db_session_factory,
            channel_session_id=session_record.id,
            conversation_id=conv_uuid,
            emitter=entry.emitter,
            storage_backend=state.storage_backend,
            on_ask_user=channel_router.register_pending_prompt,
        )
        entry.emitter.subscribe(responder)

    persistent_store = PersistentMemoryStore(
        session_factory=state.db_session_factory,
        user_id=account.user_id,
        conversation_id=conv_uuid,
    )

    # Deduplicate: Telegram may retry webhooks — skip if already processed
    async with state.db_session_factory() as db:
        if await repo.is_message_seen(
            db,
            channel_session_id=session_record.id,
            direction="inbound",
            provider_message_id=message.provider_message_id,
        ):
            logger.info(
                "channel_inbound_duplicate_skipped session={} msg_id={}",
                session_record.id,
                message.provider_message_id,
            )
            return

    try:
        async with state.db_session_factory() as db:
            await repo.log_message(
                db,
                channel_session_id=session_record.id,
                direction="inbound",
                provider_message_id=message.provider_message_id,
                content_preview=message.text,
            )
    except IntegrityError:
        logger.info(
            "channel_inbound_duplicate_race_skipped session={} msg_id={}",
            session_record.id,
            message.provider_message_id,
        )
        return

    if channel_router.has_pending_prompt(conv_uuid):
        request_id, callback = channel_router._pending_prompts.pop(conv_uuid)  # noqa: SLF001
        if callable(callback) and message.text:
            callback(message.text)
            logger.info(
                "channel_ask_user_fulfilled conv={} request={}",
                conv_uuid,
                request_id,
            )
            return

    attachments: tuple[FileAttachment, ...] = ()
    if message.file_id:
        try:
            file_data, filename, mime_type = await provider.download_file(
                message.file_id
            )
            attachments = (
                FileAttachment(
                    filename=message.file_name or filename,
                    content_type=message.file_mime_type or mime_type,
                    data=file_data,
                    size=len(file_data),
                ),
            )
        except Exception:
            logger.warning("channel_file_download_failed file_id={}", message.file_id)

    if entry.turn_task is not None and not entry.turn_task.done():
        try:
            await asyncio.wait_for(asyncio.shield(entry.turn_task), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning(
                "channel_turn_task_timeout conversation_id={}", conversation_id_str
            )

    from api.routes.conversations import _generate_title, _run_turn

    runtime_prompt_sections: tuple[str, ...] = ()
    if message.text:
        try:
            settings = get_settings()
            facts = await persistent_store.retrieve_relevant_facts(
                query=message.text,
                limit=settings.MEMORY_FACT_TOP_K,
            )
            section = format_verified_facts_prompt_section(
                facts,
                token_cap_chars=settings.MEMORY_FACT_PROMPT_TOKEN_CAP,
            )
            if section:
                runtime_prompt_sections = (section,)
        except Exception:
            logger.warning(
                "memory_fact_retrieval_failed conversation_id={}", conversation_id_str
            )

    entry.turn_task = asyncio.create_task(
        _run_turn(
            state,
            conversation_id_str,
            entry.orchestrator,
            message.text or "",
            attachments=attachments,
            runtime_prompt_sections=runtime_prompt_sections,
        )
    )

    if message.text:

        def _schedule_fact_extraction(_done: asyncio.Task[str]) -> None:
            async def _wrapped() -> None:
                try:
                    await _extract_and_upsert_facts_for_turn(
                        store=persistent_store,
                        conversation_id=conv_uuid,
                        turn_id=message.provider_message_id,
                        message_text=message.text or "",
                        source_chat_id=message.provider_chat_id,
                    )
                except Exception:
                    logger.warning(
                        "memory_fact_extraction_failed conversation_id={}",
                        conversation_id_str,
                    )

            asyncio.create_task(_wrapped())

        entry.turn_task.add_done_callback(_schedule_fact_extraction)

    if is_first_turn and message.text:
        asyncio.create_task(
            _generate_title(
                state.claude_client,
                conversation_id_str,
                message.text,
                entry.emitter,
            )
        )


@router.post("/telegram/config", dependencies=common_dependencies)
async def save_telegram_bot_config(
    body: TelegramBotConfigRequest,
    request: Request,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        existing = await repo.get_telegram_bot_config_for_user(db, user_id)

    if existing is not None and existing.enabled:
        try:
            old_provider = _build_provider(existing)
            await old_provider.delete_webhook()
        except Exception:
            logger.warning("telegram_delete_webhook_failed user_id={}", user_id)

    webhook_secret = secrets.token_urlsafe(24)
    provider = TelegramProvider(body.bot_token, webhook_secret)
    try:
        profile = await provider.get_me()
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid Telegram bot token: {exc}"
        ) from exc

    webhook_url = _webhook_url_for_request(request)
    try:
        await provider.set_webhook(webhook_url, webhook_secret)
        webhook_status = "active"
        last_error = None
    except Exception as exc:
        webhook_status = "error"
        last_error = str(exc)

    async with state.db_session_factory() as db:
        config = await repo.upsert_telegram_bot_config(
            db,
            user_id=user_id,
            bot_token=body.bot_token,
            bot_username=profile["bot_username"],
            bot_user_id=profile["bot_user_id"],
            webhook_secret=webhook_secret,
            webhook_status=webhook_status,
            enabled=True,
            last_error=last_error,
        )

    if webhook_status == "error":
        raise HTTPException(
            status_code=502,
            detail=f"Bot verified, but Telegram webhook setup failed: {last_error}",
        )

    return {
        "provider": "telegram",
        "bot_username": config.bot_username,
        "bot_user_id": config.bot_user_id,
        "masked_token": _mask_token(config.bot_token),
        "webhook_status": config.webhook_status,
        "enabled": config.enabled,
    }


@router.delete("/telegram/config", dependencies=common_dependencies)
async def disable_telegram_bot_config(
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        config = await repo.get_telegram_bot_config_for_user(db, user_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Telegram bot config not found")

    try:
        await _build_provider(config).delete_webhook()
    except Exception:
        logger.warning("telegram_delete_webhook_failed user_id={}", user_id)

    async with state.db_session_factory() as db:
        await repo.update_telegram_bot_config_status(
            db,
            config.id,
            webhook_status="disabled",
            last_error=None,
            enabled=False,
        )

    return {"status": "ok"}


@router.post(
    "/link-token", response_model=LinkTokenResponse, dependencies=common_dependencies
)
async def create_link_token(
    body: LinkTokenRequest,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> LinkTokenResponse:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        config = await repo.get_telegram_bot_config_for_user(db, user_id)
        if config is None or not config.enabled or config.webhook_status != "active":
            raise HTTPException(
                status_code=400,
                detail="Configure and enable your Telegram bot before generating a link token",
            )
        token_record = await repo.create_link_token(
            db, user_id=user_id, provider=body.provider
        )

    expires_at = (
        token_record.expires_at.replace(tzinfo=timezone.utc)
        if token_record.expires_at.tzinfo is None
        else token_record.expires_at
    )
    expires_in_minutes = max(
        1, math.ceil((expires_at - datetime.now(timezone.utc)).total_seconds() / 60)
    )
    return LinkTokenResponse(
        token=token_record.token,
        provider=token_record.provider,
        expires_in_minutes=expires_in_minutes,
    )


@router.get("/accounts", dependencies=common_dependencies)
async def list_channel_accounts(
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        accounts = await repo.list_accounts_for_user(db, user_id)

    return {
        "accounts": [
            {
                "id": str(a.id),
                "provider": a.provider,
                "provider_user_id": a.provider_user_id,
                "display_name": a.display_name,
                "status": a.status,
                "linked_at": a.linked_at.isoformat(),
            }
            for a in accounts
        ]
    }


@router.delete("/accounts/{account_id}", dependencies=common_dependencies)
async def unlink_channel_account(
    account_id: str,
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, str]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        accounts = await repo.list_accounts_for_user(db, user_id)
        if account_id not in {str(a.id) for a in accounts}:
            raise HTTPException(status_code=404, detail="Channel account not found")
        try:
            account_uuid = uuid.UUID(account_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid account ID format")
        success = await repo.unlink_account(db, account_uuid)

    if not success:
        raise HTTPException(status_code=404, detail="Channel account not found")
    return {"status": "ok"}


@router.get("/conversations", dependencies=common_dependencies)
async def list_channel_conversations(
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        records = await repo.list_channel_conversations(db, user_id)

    return {
        "conversations": [
            {
                "conversation_id": str(r.conversation_id),
                "provider": r.provider,
                "display_name": r.display_name,
                "provider_chat_id": r.provider_chat_id,
                "last_message": r.last_message,
                "last_message_at": r.last_message_at.isoformat()
                if r.last_message_at
                else None,
                "session_active": r.session_active,
            }
            for r in records
        ]
    }


@router.get("/status", dependencies=common_dependencies)
async def channel_status(
    state: AppState = Depends(get_app_state),
    auth_user: AuthUser | None = Depends(get_current_user),
) -> dict[str, Any]:
    _require_channels_enabled()
    user_id = await _resolve_user_id_or_401(state, auth_user)
    repo = _get_channel_repo()

    async with state.db_session_factory() as db:
        bot_config = await repo.get_telegram_bot_config_for_user(db, user_id)
        tg_account = await repo.find_account_by_user(db, user_id, "telegram")

    return _serialize_status(
        settings_enabled=get_settings().CHANNELS_ENABLED,
        bot_config=bot_config,
        linked=tg_account is not None,
        display_name=tg_account.display_name if tg_account else None,
    )
