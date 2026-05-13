"""Generic conversation lifecycle hooks for agent runtimes."""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


ConversationTurnStatus = Literal["completed", "cancelled", "error"]


@dataclass(frozen=True)
class ConversationSessionContext:
    """Inputs available before a conversation runtime is built."""

    conversation_id: str
    user_id: uuid.UUID | None
    mode: str
    compaction_runtime: str
    state: Any
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ConversationSessionHookResult:
    """Arbitrary resources prepared by session hooks."""

    values: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ConversationTurnContext:
    """Inputs available around a single conversation turn."""

    conversation_id: str
    user_id: uuid.UUID | None
    turn_id: str
    message: str
    source: str
    runtime_prompt_sections: tuple[str, ...]
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ContextCompactionContext:
    """Inputs available before context compaction runs."""

    conversation_id: str | None
    user_id: uuid.UUID | None
    messages: tuple[dict[str, Any], ...]
    effective_prompt: str
    profile_name: str
    metadata: Mapping[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ContextCompactionResult:
    """Result data available after context compaction runs."""

    original_message_count: int
    compacted_messages: tuple[dict[str, Any], ...]
    summary_text: str
    metadata: Mapping[str, Any] = field(default_factory=dict)


class ConversationHooks(Protocol):
    """Lifecycle hooks shared by agent runtime entrypoints."""

    async def before_session_start(
        self,
        context: ConversationSessionContext,
    ) -> ConversationSessionHookResult:
        """Prepare resources needed to construct a runtime."""
        ...

    async def before_turn(
        self,
        context: ConversationTurnContext,
    ) -> tuple[str, ...]:
        """Return runtime prompt sections for the turn."""
        ...

    async def after_turn(
        self,
        context: ConversationTurnContext,
        status: ConversationTurnStatus,
        result: str,
    ) -> None:
        """Run post-turn side effects."""
        ...

    async def before_context_compaction(
        self,
        context: ContextCompactionContext,
    ) -> None:
        """Run side effects before context compaction."""
        ...

    async def after_context_compaction(
        self,
        context: ContextCompactionContext,
        result: ContextCompactionResult,
    ) -> None:
        """Run side effects after context compaction."""
        ...


class NoopConversationHooks:
    """Default hook implementation that leaves runtime behavior unchanged."""

    async def before_session_start(
        self,
        context: ConversationSessionContext,
    ) -> ConversationSessionHookResult:
        del context
        return ConversationSessionHookResult()

    async def before_turn(
        self,
        context: ConversationTurnContext,
    ) -> tuple[str, ...]:
        return context.runtime_prompt_sections

    async def after_turn(
        self,
        context: ConversationTurnContext,
        status: ConversationTurnStatus,
        result: str,
    ) -> None:
        del context, status, result

    async def before_context_compaction(
        self,
        context: ContextCompactionContext,
    ) -> None:
        del context

    async def after_context_compaction(
        self,
        context: ContextCompactionContext,
        result: ContextCompactionResult,
    ) -> None:
        del context, result


class CompositeConversationHooks:
    """Run multiple hook implementations as one lifecycle extension point."""

    def __init__(self, hooks: tuple[ConversationHooks, ...]) -> None:
        self._hooks = hooks

    async def before_session_start(
        self,
        context: ConversationSessionContext,
    ) -> ConversationSessionHookResult:
        values: dict[str, Any] = {}
        for hook in self._hooks:
            result = await hook.before_session_start(context)
            values.update(result.values)
        return ConversationSessionHookResult(values)

    async def before_turn(
        self,
        context: ConversationTurnContext,
    ) -> tuple[str, ...]:
        sections = context.runtime_prompt_sections
        for hook in self._hooks:
            context = ConversationTurnContext(
                conversation_id=context.conversation_id,
                user_id=context.user_id,
                turn_id=context.turn_id,
                message=context.message,
                source=context.source,
                runtime_prompt_sections=sections,
                metadata=context.metadata,
            )
            sections = await hook.before_turn(context)
        return sections

    async def after_turn(
        self,
        context: ConversationTurnContext,
        status: ConversationTurnStatus,
        result: str,
    ) -> None:
        for hook in self._hooks:
            await hook.after_turn(context, status, result)

    async def before_context_compaction(
        self,
        context: ContextCompactionContext,
    ) -> None:
        for hook in self._hooks:
            await hook.before_context_compaction(context)

    async def after_context_compaction(
        self,
        context: ContextCompactionContext,
        result: ContextCompactionResult,
    ) -> None:
        for hook in self._hooks:
            await hook.after_context_compaction(context, result)
