"""PostgreSQL repository for conversation persistence.

All methods receive an ``AsyncSession`` via dependency injection.
All returned records are frozen dataclasses from ``schemas.py`` —
ORM models never leak beyond this module.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import column, func, select, table
from sqlalchemy.ext.asyncio import AsyncSession

from agent.state.models import (
    AgentRunModel,
    ArtifactModel,
    ConversationModel,
    EventModel,
    MessageModel,
    SkillModel,
    TokenUsageModel,
    UserPromptModel,
    UserModel,
)
from agent.state.schemas import (
    AgentRunRecord,
    ArtifactRecord,
    ConversationArtifactsRecord,
    ConversationRecord,
    EventRecord,
    MessageRecord,
    SkillRecord,
    TokenUsageRecord,
    UserPromptRecord,
    UserRecord,
    UserUsageSummary,
)

_SUMMARY_SEPARATOR = "\n\n---\n\n"


def _trim_context_summary_fragment(fragment: str, max_chars: int) -> str:
    """Trim a single fragment without dropping its heading marker."""
    cleaned = fragment.strip()
    if len(cleaned) <= max_chars:
        return cleaned

    lines = cleaned.splitlines()
    if lines and lines[0].startswith("## "):
        heading = lines[0]
        body = "\n".join(lines[1:]).strip()
        if not body:
            return heading[:max_chars]
        marker = "[...]\n"
        available = max_chars - len(heading) - 1 - len(marker)
        if available <= 0:
            return heading[:max_chars]
        return f"{heading}\n{marker}{body[-available:]}"

    marker = "[...]"
    if max_chars <= len(marker):
        return marker[:max_chars]
    return f"{marker}{cleaned[-(max_chars - len(marker)) :]}"


def _trim_context_summary(merged: str, max_chars: int) -> str:
    """Keep the newest whole fragments when possible, otherwise trim one fragment."""
    cleaned = merged.strip()
    if len(cleaned) <= max_chars:
        return cleaned

    fragments = [
        frag.strip() for frag in cleaned.split(_SUMMARY_SEPARATOR) if frag.strip()
    ]
    kept: list[str] = []
    current_len = 0
    for fragment in reversed(fragments):
        extra = len(fragment) if not kept else len(_SUMMARY_SEPARATOR) + len(fragment)
        if current_len + extra <= max_chars:
            kept.append(fragment)
            current_len += extra
            continue
        if not kept:
            kept.append(_trim_context_summary_fragment(fragment, max_chars))
        break
    return _SUMMARY_SEPARATOR.join(reversed(kept))


def _to_conversation(model: ConversationModel) -> ConversationRecord:
    return ConversationRecord(
        id=model.id,
        user_id=model.user_id,
        title=model.title,
        orchestrator_mode=model.orchestrator_mode,
        context_summary=model.context_summary,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


def _to_message(model: MessageModel) -> MessageRecord:
    return MessageRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        role=model.role,
        content=model.content,
        iteration=model.iteration,
        created_at=model.created_at,
    )


def _to_event(model: EventModel) -> EventRecord:
    return EventRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        event_type=model.event_type,
        data=model.data,
        iteration=model.iteration,
        timestamp=model.timestamp,
    )


def _to_user_prompt(model: UserPromptModel) -> UserPromptRecord:
    return UserPromptRecord(
        request_id=model.request_id,
        conversation_id=model.conversation_id,
        question=model.question,
        prompt_kind=model.prompt_kind,
        title=model.title,
        options=tuple(model.options or ()),
        prompt_metadata=model.prompt_metadata,
        status=model.status,
        response=model.response,
        created_at=model.created_at,
        responded_at=model.responded_at,
    )


def _to_agent_run(model: AgentRunModel) -> AgentRunRecord:
    return AgentRunRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        config=model.config,
        status=model.status,
        result=model.result,
        created_at=model.created_at,
    )


def _to_artifact(model: ArtifactModel) -> ArtifactRecord:
    return ArtifactRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        storage_key=model.storage_key,
        original_name=model.original_name,
        content_type=model.content_type,
        size=model.size,
        created_at=model.created_at,
        file_path=model.file_path,
    )


class ConversationRepository:
    """Async repository for conversation persistence backed by PostgreSQL."""

    async def create_conversation(
        self,
        session: AsyncSession,
        title: str | None = None,
        conversation_id: uuid.UUID | None = None,
        user_id: uuid.UUID | None = None,
        orchestrator_mode: str = "agent",
    ) -> ConversationRecord:
        model = ConversationModel(
            id=conversation_id or uuid.uuid4(),
            title=title,
            user_id=user_id,
            orchestrator_mode=orchestrator_mode,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)  # need generated id/timestamps before returning
        await session.commit()
        return _to_conversation(model)

    async def get_conversation(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> ConversationRecord | None:
        stmt = select(ConversationModel).where(ConversationModel.id == conversation_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_conversation(model) if model else None

    async def list_conversations(
        self,
        session: AsyncSession,
        limit: int = 20,
        offset: int = 0,
        search: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> tuple[list[ConversationRecord], int]:
        # Subquery to exclude conversations owned by a channel session
        _channel_sessions = table("channel_sessions", column("conversation_id"))
        _channel_conv_ids = select(_channel_sessions.c.conversation_id)

        count_stmt = select(func.count()).select_from(ConversationModel)
        count_stmt = count_stmt.where(~ConversationModel.id.in_(_channel_conv_ids))
        if user_id is not None:
            count_stmt = count_stmt.where(ConversationModel.user_id == user_id)
        if search:
            count_stmt = count_stmt.where(ConversationModel.title.ilike(f"%{search}%"))
        total = (await session.execute(count_stmt)).scalar_one()

        stmt = (
            select(ConversationModel)
            .where(~ConversationModel.id.in_(_channel_conv_ids))
            .order_by(ConversationModel.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if user_id is not None:
            stmt = stmt.where(ConversationModel.user_id == user_id)
        if search:
            stmt = stmt.where(ConversationModel.title.ilike(f"%{search}%"))
        result = await session.execute(stmt)
        items = [_to_conversation(m) for m in result.scalars().all()]
        return items, total

    async def delete_conversation(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> bool:
        """Delete a conversation by ID. Returns True if found and deleted."""
        stmt = select(ConversationModel).where(ConversationModel.id == conversation_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return False
        await session.delete(model)
        await session.commit()
        return True

    async def update_conversation(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        title: str | None = None,
        context_summary: str | None = None,
        orchestrator_mode: str | None = None,
    ) -> ConversationRecord:
        stmt = select(ConversationModel).where(ConversationModel.id == conversation_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            raise ValueError(f"Conversation not found: {conversation_id}")

        if title is not None:
            model.title = title
        if context_summary is not None:
            model.context_summary = context_summary
        if orchestrator_mode is not None:
            model.orchestrator_mode = orchestrator_mode
        model.updated_at = datetime.now(timezone.utc)

        await session.commit()
        await session.refresh(model)  # refresh after commit to get final state
        return _to_conversation(model)

    async def merge_conversation_context_summary(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        new_fragment: str,
        max_chars: int,
    ) -> None:
        """Append *new_fragment* to rolling context_summary, capped at *max_chars* tail."""
        fragment = new_fragment.strip()
        if not fragment:
            return

        stmt = select(ConversationModel).where(ConversationModel.id == conversation_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return

        prev = (model.context_summary or "").strip()
        if prev:
            merged = f"{prev}{_SUMMARY_SEPARATOR}{fragment}"
        else:
            merged = fragment
        model.context_summary = _trim_context_summary(merged, max_chars)
        model.updated_at = datetime.now(timezone.utc)
        await session.commit()

    async def save_message(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        role: str,
        content: dict,
        iteration: int | None = None,
    ) -> MessageRecord:
        model = MessageModel(
            id=uuid.uuid4(),
            conversation_id=conversation_id,
            role=role,
            content=content,
            iteration=iteration,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)  # need generated timestamps before returning
        await session.commit()
        return _to_message(model)

    async def get_messages(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> list[MessageRecord]:
        stmt = (
            select(MessageModel)
            .where(MessageModel.conversation_id == conversation_id)
            .order_by(MessageModel.created_at.asc())
        )
        result = await session.execute(stmt)
        return [_to_message(m) for m in result.scalars().all()]

    async def get_recent_messages(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        limit: int,
    ) -> list[MessageRecord]:
        """Return the last *limit* messages in chronological order."""
        if limit < 1:
            return []
        stmt = (
            select(MessageModel)
            .where(MessageModel.conversation_id == conversation_id)
            .order_by(MessageModel.created_at.desc())
            .limit(limit)
        )
        result = await session.execute(stmt)
        rows = list(result.scalars().all())
        rows.reverse()
        return [_to_message(m) for m in rows]

    async def save_event(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        event_type: str,
        data: dict,
        iteration: int | None = None,
    ) -> None:
        model = EventModel(
            conversation_id=conversation_id,
            event_type=event_type,
            data=data,
            iteration=iteration,
        )
        session.add(model)
        await session.commit()

    async def get_events(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        limit: int | None = None,
        offset: int = 0,
    ) -> list[EventRecord]:
        """Return conversation events in causal order.

        When *limit* is ``None`` (default), all rows are returned. A numeric
        *limit* applies to the ordered query — avoid using a low default here:
        callers that need the full timeline (history replay, metrics) must not
        silently drop the newest events.
        """
        stmt = (
            select(EventModel)
            .where(EventModel.conversation_id == conversation_id)
            .order_by(EventModel.timestamp.asc(), EventModel.id.asc())
        )
        if limit is not None:
            stmt = stmt.limit(limit).offset(offset)
        result = await session.execute(stmt)
        return [_to_event(m) for m in result.scalars().all()]

    async def save_artifact(
        self,
        session: AsyncSession,
        artifact_id: str,
        conversation_id: uuid.UUID,
        storage_key: str,
        original_name: str,
        content_type: str,
        size: int,
        file_path: str | None = None,
    ) -> ArtifactRecord:
        model = ArtifactModel(
            id=artifact_id,
            conversation_id=conversation_id,
            storage_key=storage_key,
            original_name=original_name,
            content_type=content_type,
            size=size,
            file_path=file_path,
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)  # need generated timestamps before returning
        await session.commit()
        return _to_artifact(model)

    async def delete_artifacts(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        artifact_ids: list[str],
    ) -> int:
        from sqlalchemy import delete

        stmt = delete(ArtifactModel).where(
            ArtifactModel.conversation_id == conversation_id,
            ArtifactModel.id.in_(artifact_ids),
        )
        result = await session.execute(stmt)
        await session.commit()
        return getattr(result, "rowcount", 0)

    async def get_artifact(
        self,
        session: AsyncSession,
        artifact_id: str,
    ) -> ArtifactRecord | None:
        stmt = select(ArtifactModel).where(ArtifactModel.id == artifact_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_artifact(model) if model else None

    async def list_artifacts(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> list[ArtifactRecord]:
        stmt = (
            select(ArtifactModel)
            .where(ArtifactModel.conversation_id == conversation_id)
            .order_by(ArtifactModel.created_at.desc(), ArtifactModel.id.desc())
        )
        result = await session.execute(stmt)
        return [_to_artifact(model) for model in result.scalars().all()]

    async def list_artifacts_grouped(
        self,
        session: AsyncSession,
        limit: int = 20,
        offset: int = 0,
        user_id: uuid.UUID | None = None,
    ) -> tuple[list[ConversationArtifactsRecord], int]:
        """List conversations that have artifacts, with artifacts grouped per conversation."""
        # Subquery: conversation IDs that have at least one artifact
        has_artifacts = (
            select(ArtifactModel.conversation_id).distinct().scalar_subquery()
        )

        # Count total conversations with artifacts
        count_stmt = (
            select(func.count())
            .select_from(ConversationModel)
            .where(ConversationModel.id.in_(has_artifacts))
        )
        if user_id is not None:
            count_stmt = count_stmt.where(ConversationModel.user_id == user_id)
        total = (await session.execute(count_stmt)).scalar_one()

        # Fetch paginated conversations
        conv_stmt = (
            select(ConversationModel)
            .where(ConversationModel.id.in_(has_artifacts))
            .order_by(ConversationModel.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if user_id is not None:
            conv_stmt = conv_stmt.where(ConversationModel.user_id == user_id)
        conv_result = await session.execute(conv_stmt)
        conversations = conv_result.scalars().all()

        # For each conversation, load its artifacts
        records: list[ConversationArtifactsRecord] = []
        for conv in conversations:
            art_stmt = (
                select(ArtifactModel)
                .where(ArtifactModel.conversation_id == conv.id)
                .order_by(ArtifactModel.created_at.desc())
            )
            art_result = await session.execute(art_stmt)
            artifacts = tuple(_to_artifact(a) for a in art_result.scalars().all())
            records.append(
                ConversationArtifactsRecord(
                    conversation_id=conv.id,
                    conversation_title=conv.title,
                    conversation_created_at=conv.created_at,
                    artifacts=artifacts,
                )
            )

        return records, total


class UserPromptRepository:
    """Async repository for persisted ask-user prompt state."""

    async def create_prompt(
        self,
        session: AsyncSession,
        *,
        request_id: str,
        conversation_id: uuid.UUID,
        question: str,
        prompt_kind: str = "freeform",
        title: str | None = None,
        options: list[dict[str, object]] | None = None,
        prompt_metadata: dict[str, object] | None = None,
    ) -> UserPromptRecord:
        existing = await self.get_prompt(session, request_id=request_id)
        if existing is not None:
            return existing

        model = UserPromptModel(
            request_id=request_id,
            conversation_id=conversation_id,
            question=question,
            prompt_kind=prompt_kind,
            title=title,
            options=options,
            prompt_metadata=prompt_metadata,
            status="pending",
        )
        session.add(model)
        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_user_prompt(model)

    async def get_prompt(
        self,
        session: AsyncSession,
        *,
        request_id: str,
    ) -> UserPromptRecord | None:
        stmt = select(UserPromptModel).where(UserPromptModel.request_id == request_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_user_prompt(model) if model else None

    async def fulfill_prompt(
        self,
        session: AsyncSession,
        *,
        request_id: str,
        response: str,
    ) -> UserPromptRecord | None:
        stmt = select(UserPromptModel).where(UserPromptModel.request_id == request_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return None
        if model.status == "responded":
            return _to_user_prompt(model)

        model.status = "responded"
        model.response = response
        model.responded_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(model)
        return _to_user_prompt(model)


# ---------------------------------------------------------------------------
# User repository
# ---------------------------------------------------------------------------


def _to_user(model: UserModel) -> UserRecord:
    return UserRecord(
        id=model.id,
        google_id=model.google_id,
        email=model.email,
        name=model.name,
        picture=model.picture,
        theme=model.theme,
        locale=model.locale,
        created_at=model.created_at,
        updated_at=model.updated_at,
    )


class UserRepository:
    """Async repository for user persistence."""

    async def find_by_google_id(
        self,
        session: AsyncSession,
        google_id: str,
    ) -> UserRecord | None:
        stmt = select(UserModel).where(UserModel.google_id == google_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_user(model) if model else None

    async def find_by_id(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
    ) -> UserRecord | None:
        stmt = select(UserModel).where(UserModel.id == user_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_user(model) if model else None

    async def update_preferences(
        self,
        session: AsyncSession,
        google_id: str,
        theme: str | None = None,
        locale: str | None = None,
    ) -> UserRecord | None:
        """Update user theme/locale preferences. Returns None if user not found."""
        stmt = select(UserModel).where(UserModel.google_id == google_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return None

        if theme is not None:
            model.theme = theme
        if locale is not None:
            model.locale = locale
        model.updated_at = datetime.now(timezone.utc)

        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_user(model)

    async def upsert_from_google(
        self,
        session: AsyncSession,
        google_id: str,
        email: str,
        name: str,
        picture: str | None,
    ) -> UserRecord:
        """Create or update a user from Google profile info."""
        stmt = select(UserModel).where(UserModel.google_id == google_id)
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()

        if model is None:
            model = UserModel(
                id=uuid.uuid4(),
                google_id=google_id,
                email=email,
                name=name,
                picture=picture,
            )
            session.add(model)
        else:
            model.email = email
            model.name = name
            model.picture = picture
            model.updated_at = datetime.now(timezone.utc)

        await session.flush()
        await session.refresh(model)
        await session.commit()
        return _to_user(model)


# ---------------------------------------------------------------------------
# Skill repository
# ---------------------------------------------------------------------------


def _to_skill(model: SkillModel) -> SkillRecord:
    return SkillRecord(
        id=model.id,
        user_id=model.user_id,
        name=model.name,
        description=model.description,
        source_type=model.source_type,
        source_path=model.source_path,
        enabled=model.enabled,
        activation_count=model.activation_count,
        last_activated_at=model.last_activated_at,
        installed_at=model.installed_at,
        updated_at=model.updated_at,
    )


class SkillRepository:
    """Async repository for skill metadata persistence.

    Bundled skills are shared (user_id=NULL) and synced once at startup.
    User-installed skills have a user_id and are per-user.
    """

    async def sync_shared_skills(
        self,
        session: AsyncSession,
        discovered: list[tuple[str, str, str, str]],
    ) -> None:
        """Sync filesystem-discovered bundled skills (user_id=NULL).

        ``discovered`` is a list of (name, description, source_type, source_path)
        tuples. Stale shared skills are removed. New ones are inserted.
        Existing ones have description/source updated while preserving
        activation_count.
        """
        discovered_names = {name for name, _, _, _ in discovered}

        # Fetch existing bundled skills
        stmt = select(SkillModel).where(SkillModel.source_type == "bundled")
        result = await session.execute(stmt)
        existing = {m.name: m for m in result.scalars().all()}

        # Remove skills no longer on disk
        for name, model in existing.items():
            if name not in discovered_names:
                await session.delete(model)

        # Upsert discovered skills
        for name, description, source_type, source_path in discovered:
            model = existing.get(name)
            if model is None:
                session.add(
                    SkillModel(
                        user_id=None,
                        name=name,
                        description=description,
                        source_type=source_type,
                        source_path=source_path,
                    )
                )
            else:
                model.description = description
                model.source_type = source_type
                model.source_path = source_path
                model.updated_at = datetime.now(timezone.utc)

        await session.commit()

    async def sync_user_skills(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        discovered: list[tuple[str, str, str, str]],
    ) -> None:
        """Sync user-installed skills for a specific user.

        ``discovered`` is a list of (name, description, source_type, source_path)
        tuples for non-bundled skills.
        """
        discovered_names = {name for name, _, _, _ in discovered}

        stmt = select(SkillModel).where(SkillModel.user_id == user_id)
        result = await session.execute(stmt)
        existing = {m.name: m for m in result.scalars().all()}

        for name, model in existing.items():
            if name not in discovered_names:
                await session.delete(model)

        for name, description, source_type, source_path in discovered:
            model = existing.get(name)
            if model is None:
                session.add(
                    SkillModel(
                        user_id=user_id,
                        name=name,
                        description=description,
                        source_type=source_type,
                        source_path=source_path,
                    )
                )
            else:
                model.description = description
                model.source_type = source_type
                model.source_path = source_path
                model.updated_at = datetime.now(timezone.utc)

        await session.commit()

    async def list_skills(
        self,
        session: AsyncSession,
        user_id: uuid.UUID | None = None,
    ) -> list[SkillRecord]:
        """Return skills visible to a user (bundled + user-owned), ordered by activation count."""
        from sqlalchemy import or_

        conditions = [SkillModel.source_type == "bundled"]
        if user_id is not None:
            conditions.append(SkillModel.user_id == user_id)

        stmt = (
            select(SkillModel)
            .where(or_(*conditions))
            .order_by(SkillModel.activation_count.desc())
        )
        result = await session.execute(stmt)
        return [_to_skill(m) for m in result.scalars().all()]

    async def get_skill(
        self,
        session: AsyncSession,
        name: str,
        user_id: uuid.UUID | None = None,
    ) -> SkillRecord | None:
        """Find a skill by name — checks user-owned first, then bundled."""
        from sqlalchemy import or_

        conditions = [SkillModel.source_type == "bundled"]
        if user_id is not None:
            conditions.append(SkillModel.user_id == user_id)

        stmt = (
            select(SkillModel)
            .where(SkillModel.name == name, or_(*conditions))
            .order_by(SkillModel.user_id.desc().nulls_last())
            .limit(1)
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_skill(model) if model else None

    async def record_activation(
        self,
        session: AsyncSession,
        name: str,
        user_id: uuid.UUID | None = None,
    ) -> None:
        """Increment activation count. Prefers user-owned row, falls back to bundled."""
        from sqlalchemy import or_

        conditions = [SkillModel.source_type == "bundled"]
        if user_id is not None:
            conditions.append(SkillModel.user_id == user_id)

        stmt = (
            select(SkillModel)
            .where(SkillModel.name == name, or_(*conditions))
            .order_by(SkillModel.user_id.desc().nulls_last())
            .limit(1)
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is not None:
            model.activation_count = model.activation_count + 1
            model.last_activated_at = datetime.now(timezone.utc)
            await session.commit()

    async def set_enabled(
        self,
        session: AsyncSession,
        name: str,
        enabled: bool,
        user_id: uuid.UUID | None = None,
    ) -> SkillRecord | None:
        """Toggle a skill's enabled state. Returns None if not found."""
        from sqlalchemy import or_

        conditions = [SkillModel.source_type == "bundled"]
        if user_id is not None:
            conditions.append(SkillModel.user_id == user_id)

        stmt = (
            select(SkillModel)
            .where(SkillModel.name == name, or_(*conditions))
            .order_by(SkillModel.user_id.desc().nulls_last())
            .limit(1)
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        if model is None:
            return None
        model.enabled = enabled
        model.updated_at = datetime.now(timezone.utc)
        await session.commit()
        await session.refresh(model)
        return _to_skill(model)


# ---------------------------------------------------------------------------
# Usage repository
# ---------------------------------------------------------------------------


def _to_token_usage(
    model: TokenUsageModel,
    *,
    conversation_title: str | None = None,
) -> TokenUsageRecord:
    return TokenUsageRecord(
        id=model.id,
        conversation_id=model.conversation_id,
        user_id=model.user_id,
        input_tokens=model.input_tokens,
        output_tokens=model.output_tokens,
        request_count=model.request_count,
        created_at=model.created_at,
        updated_at=model.updated_at,
        conversation_title=conversation_title,
    )


class UsageRepository:
    """Async repository for token usage tracking."""

    async def increment(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
        user_id: uuid.UUID | None,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        """Upsert token usage: create row or atomically increment counters."""
        from sqlalchemy.dialects.postgresql import insert

        stmt = insert(TokenUsageModel).values(
            conversation_id=conversation_id,
            user_id=user_id,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            request_count=1,
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["conversation_id"],
            set_={
                "input_tokens": TokenUsageModel.input_tokens + input_tokens,
                "output_tokens": TokenUsageModel.output_tokens + output_tokens,
                "request_count": TokenUsageModel.request_count + 1,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        await session.execute(stmt)
        await session.commit()

    async def get_conversation_usage(
        self,
        session: AsyncSession,
        conversation_id: uuid.UUID,
    ) -> TokenUsageRecord | None:
        """Return token usage for a single conversation."""
        stmt = select(TokenUsageModel).where(
            TokenUsageModel.conversation_id == conversation_id
        )
        result = await session.execute(stmt)
        model = result.scalar_one_or_none()
        return _to_token_usage(model) if model else None

    async def get_user_usage(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        since: datetime | None = None,
    ) -> UserUsageSummary:
        """Aggregate token usage across all conversations for a user."""
        stmt = select(
            func.coalesce(func.sum(TokenUsageModel.input_tokens), 0),
            func.coalesce(func.sum(TokenUsageModel.output_tokens), 0),
            func.coalesce(func.sum(TokenUsageModel.request_count), 0),
            func.count(),
        ).where(TokenUsageModel.user_id == user_id)

        if since is not None:
            stmt = stmt.where(TokenUsageModel.created_at >= since)

        result = await session.execute(stmt)
        row = result.one()
        return UserUsageSummary(
            user_id=user_id,
            total_input_tokens=int(row[0]),
            total_output_tokens=int(row[1]),
            total_requests=int(row[2]),
            conversation_count=int(row[3]),
        )

    async def list_conversation_usage(
        self,
        session: AsyncSession,
        user_id: uuid.UUID,
        limit: int = 20,
        offset: int = 0,
    ) -> tuple[list[TokenUsageRecord], int]:
        """Paginated per-conversation usage breakdown for a user."""
        count_stmt = (
            select(func.count())
            .select_from(TokenUsageModel)
            .where(TokenUsageModel.user_id == user_id)
        )
        total = (await session.execute(count_stmt)).scalar_one()

        stmt = (
            select(TokenUsageModel, ConversationModel.title)
            .join(
                ConversationModel,
                TokenUsageModel.conversation_id == ConversationModel.id,
            )
            .where(TokenUsageModel.user_id == user_id)
            .order_by(TokenUsageModel.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await session.execute(stmt)
        items = [
            _to_token_usage(row[0], conversation_title=row[1]) for row in result.all()
        ]
        return items, total
