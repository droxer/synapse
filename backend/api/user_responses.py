"""Shared coordinator for persisted ask-user prompts and responses."""

from __future__ import annotations

import asyncio
import uuid

from agent.state.repository import ConversationRepository, UserPromptRepository


class UserResponseCoordinator:
    """Bridges local in-process waiters with persisted prompt responses."""

    def __init__(
        self,
        *,
        session_factory: object,
        prompt_repo: UserPromptRepository,
        conversation_repo: ConversationRepository,
    ) -> None:
        self._session_factory = session_factory
        self._prompt_repo = prompt_repo
        self._conversation_repo = conversation_repo
        self._waiters: dict[tuple[str, str], asyncio.Future[str]] = {}

    async def register_prompt(
        self,
        *,
        conversation_id: str,
        request_id: str,
        question: str,
        prompt_kind: str = "freeform",
        title: str | None = None,
        options: list[dict[str, object]] | None = None,
        prompt_metadata: dict[str, object] | None = None,
    ) -> None:
        async with self._session_factory() as session:
            await self._prompt_repo.create_prompt(
                session,
                request_id=request_id,
                conversation_id=uuid.UUID(conversation_id),
                question=question,
                prompt_kind=prompt_kind,
                title=title,
                options=options,
                prompt_metadata=prompt_metadata,
            )

    def register_local_waiter(
        self,
        *,
        conversation_id: str,
        request_id: str,
    ) -> asyncio.Future[str]:
        key = (conversation_id, request_id)
        future: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._waiters[key] = future
        return future

    def resolve_local(
        self,
        *,
        conversation_id: str,
        request_id: str,
        response: str,
    ) -> None:
        future = self._waiters.get((conversation_id, request_id))
        if future is not None and not future.done():
            future.set_result(response)

    async def wait_for_response(
        self,
        *,
        conversation_id: str,
        request_id: str,
        future: asyncio.Future[str],
        timeout: float,
    ) -> str:
        try:
            return await asyncio.wait_for(
                self._poll_or_wait(
                    conversation_id=conversation_id,
                    request_id=request_id,
                    future=future,
                ),
                timeout=timeout,
            )
        finally:
            self._waiters.pop((conversation_id, request_id), None)

    async def _poll_or_wait(
        self,
        *,
        conversation_id: str,
        request_id: str,
        future: asyncio.Future[str],
    ) -> str:
        while True:
            if future.done():
                return future.result()
            async with self._session_factory() as session:
                prompt = await self._prompt_repo.get_prompt(
                    session,
                    request_id=request_id,
                )
            if (
                prompt is not None
                and str(prompt.conversation_id) == conversation_id
                and prompt.status == "responded"
                and prompt.response is not None
            ):
                return prompt.response
            await asyncio.sleep(0.25)

    async def submit_response(
        self,
        *,
        conversation_id: str,
        request_id: str,
        response: str,
    ) -> bool:
        async with self._session_factory() as session:
            conversation = await self._conversation_repo.get_conversation(
                session,
                uuid.UUID(conversation_id),
            )
            if conversation is None:
                return False
            prompt = await self._prompt_repo.get_prompt(session, request_id=request_id)
            if prompt is None or str(prompt.conversation_id) != conversation_id:
                return False
            await self._prompt_repo.fulfill_prompt(
                session,
                request_id=request_id,
                response=response,
            )
            await self._conversation_repo.save_message(
                session,
                uuid.UUID(conversation_id),
                role="user",
                content={"text": response},
                iteration=None,
            )
            await self._conversation_repo.save_event(
                session,
                uuid.UUID(conversation_id),
                event_type="user_response",
                data={"request_id": request_id, "response": response},
                iteration=None,
            )

        self.resolve_local(
            conversation_id=conversation_id,
            request_id=request_id,
            response=response,
        )
        return True
