"""Tests for the server-to-server /v1 integration API."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("TAVILY_API_KEY", "test-key")

from agent.artifacts.storage import LocalStorageBackend  # noqa: E402
from agent.state.models import AgentRunModel, Base  # noqa: E402
from agent.state.repository import ConversationRepository  # noqa: E402
from api.db_subscriber import PendingWrites  # noqa: E402
from api.events import AgentEvent, EventEmitter, EventType  # noqa: E402
from api.models import ConversationEntry, UserInputRequest  # noqa: E402
from api.routes import v1  # noqa: E402
from api.routes.conversations import ORCHESTRATOR_AGENT  # noqa: E402
from api.user_responses import SubmitResponseResult, SubmitResponseStatus  # noqa: E402
from config.settings import get_settings  # noqa: E402


@pytest.fixture(autouse=True)
def _clear_settings_cache() -> None:
    get_settings.cache_clear()
    v1._v1_rate_limiters.clear()
    yield
    v1._v1_rate_limiters.clear()
    get_settings.cache_clear()


async def _make_state(tmp_path):
    db_path = tmp_path / "v1_state.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    state = SimpleNamespace(
        db_session_factory=session_factory,
        db_repo=ConversationRepository(),
        db_pending_writes=PendingWrites(),
        skill_repo=None,
        user_prompt_repo=None,
        usage_repo=None,
        response_coordinator=None,
        conversations={},
        claude_client=object(),
        sandbox_provider=object(),
        storage_backend=LocalStorageBackend(str(tmp_path / "artifacts")),
        mcp_state=None,
    )
    return state, engine, session_factory


def test_openapi_exposes_v1_agent_run_schema() -> None:
    app = FastAPI()
    app.include_router(v1.router)

    schema = app.openapi()

    operation = schema["paths"]["/v1/agent-runs"]["post"]
    assert "requestBody" in operation
    request_schema = operation["requestBody"]["content"]["application/json"]["schema"]
    assert request_schema["$ref"].endswith("/AgentRunCreateRequest")
    assert operation["responses"]["202"]["content"]["application/json"]["schema"][
        "$ref"
    ].endswith("/AgentRunResponse")


@pytest.mark.asyncio
async def test_v1_auth_requires_configured_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("API_KEYS", "secret-one,secret-two")
    get_settings.cache_clear()

    auth = await v1.require_integration_api_key("Bearer secret-two")

    assert auth.api_key_hash == v1._hash_api_key("secret-two")

    with pytest.raises(HTTPException) as exc_info:
        await v1.require_integration_api_key("Bearer wrong")
    assert exc_info.value.status_code == 401
    assert exc_info.value.detail["error"]["code"] == "unauthorized"


@pytest.mark.asyncio
async def test_create_agent_run_reuses_persisted_idempotency_key(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db_path = tmp_path / "v1.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    state = SimpleNamespace(
        db_session_factory=session_factory,
        db_repo=ConversationRepository(),
        db_pending_writes=PendingWrites(),
        skill_repo=None,
        user_prompt_repo=None,
        usage_repo=None,
        response_coordinator=None,
        conversations={},
        claude_client=object(),
        sandbox_provider=object(),
        storage_backend=object(),
        mcp_state=None,
    )
    scheduled: list[object] = []

    def _fake_start_turn_task(entry, coro, *, idempotency_key=None):
        del entry, idempotency_key
        scheduled.append(coro)
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return SimpleNamespace(done=lambda: False, cancel=lambda: None)

    monkeypatch.setattr(v1, "_start_turn_task", _fake_start_turn_task)
    body = v1.AgentRunCreateRequest(message="hello")
    request = SimpleNamespace(cookies={})
    auth = v1.IntegrationAuth(api_key_hash=v1._hash_api_key("secret"))

    first = await v1.create_agent_run(
        body,
        request,
        idempotency_header="same-key",
        state=state,
        auth=auth,
    )
    second = await v1.create_agent_run(
        body,
        request,
        idempotency_header="same-key",
        state=state,
        auth=auth,
    )

    assert second.run_id == first.run_id
    assert second.conversation_id == first.conversation_id
    assert len(scheduled) == 1

    await engine.dispose()


def test_public_event_payload_maps_internal_events() -> None:
    payload = v1._public_event_payload(
        event_type="tool_call",
        data={
            "tool_name": "web_search",
            "tool_id": "call_1",
            "tool_input": {"query": "docs"},
        },
        timestamp=123.0,
        iteration=2,
        run_id="run_1",
        conversation_id="conv_1",
    )

    assert payload == {
        "event_type": "tool.started",
        "run_id": "run_1",
        "conversation_id": "conv_1",
        "data": {
            "tool_name": "web_search",
            "tool_call_id": "call_1",
            "tool_input": {"query": "docs"},
            "category": "tool",
        },
        "timestamp": 123.0,
        "iteration": 2,
    }


def test_public_event_payload_maps_reasoning_skills_and_mcp_tools() -> None:
    reasoning = v1._public_event_payload(
        event_type="thinking",
        data={"thinking": "Inspect the code."},
        timestamp=123.0,
        iteration=1,
        run_id="run_1",
        conversation_id="conv_1",
    )
    skill = v1._public_event_payload(
        event_type="skill_activated",
        data={"name": "frontend-design", "source": "auto"},
        timestamp=124.0,
        iteration=1,
        run_id="run_1",
        conversation_id="conv_1",
    )
    mcp_tool = v1._public_event_payload(
        event_type="tool_call",
        data={
            "tool_name": "docs__lookup",
            "tool_id": "tool_1",
            "tool_input": {"query": "api"},
        },
        timestamp=125.0,
        iteration=1,
        run_id="run_1",
        conversation_id="conv_1",
    )
    mcp_tool_completed = v1._public_event_payload(
        event_type="tool_result",
        data={
            "tool_name": "docs__lookup",
            "tool_id": "tool_1",
            "success": True,
            "result": "ok",
        },
        timestamp=126.0,
        iteration=1,
        run_id="run_1",
        conversation_id="conv_1",
    )

    assert reasoning is not None
    assert reasoning["event_type"] == "reasoning"
    assert reasoning["data"]["text"] == "Inspect the code."
    assert skill is not None
    assert skill["event_type"] == "skill.activated"
    assert skill["data"]["name"] == "frontend-design"
    assert mcp_tool is not None
    assert mcp_tool["event_type"] == "tool.started"
    assert mcp_tool["data"]["category"] == "mcp"
    assert mcp_tool_completed is not None
    assert mcp_tool_completed["event_type"] == "tool.completed"
    assert mcp_tool_completed["data"]["category"] == "mcp"


@pytest.mark.asyncio
async def test_public_event_generator_returns_terminal_history(
    tmp_path,
) -> None:
    db_path = tmp_path / "events.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    repo = ConversationRepository()
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=v1._hash_api_key("secret"),
            idempotency_key="events-key",
            status="completed",
            config={},
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "turn_start",
            {"run_id": str(run.id), "message": "hello"},
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "turn_complete",
            {"result": "done"},
        )

    state = SimpleNamespace(db_session_factory=session_factory, db_repo=repo)
    chunks: list[str] = []
    async for chunk in v1._public_event_generator(state, run):
        chunks.append(chunk)
        if "event: done" in chunk:
            break

    assert any("event: run.started" in chunk for chunk in chunks)
    assert any("event: run.completed" in chunk for chunk in chunks)
    assert chunks[-1] == "event: done\ndata: {}\n\n"

    await engine.dispose()


@pytest.mark.asyncio
async def test_public_event_generator_supports_ndjson(
    tmp_path,
) -> None:
    db_path = tmp_path / "events_ndjson.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    repo = ConversationRepository()
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=v1._hash_api_key("secret"),
            idempotency_key="events-ndjson-key",
            status="completed",
            config={},
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "turn_start",
            {"run_id": str(run.id), "message": "hello"},
        )

    state = SimpleNamespace(db_session_factory=session_factory, db_repo=repo)
    chunks: list[str] = []
    async for chunk in v1._public_event_generator(
        state,
        run,
        stream_format="ndjson",
    ):
        chunks.append(chunk)
        if '"event_type": "done"' in chunk:
            break

    assert chunks[0].startswith('{"event_type": "run.started"')
    assert chunks[-1] == '{"event_type": "done", "data": {}}\n'

    await engine.dispose()


@pytest.mark.asyncio
async def test_get_agent_run_result_supports_text_and_html(
    tmp_path,
) -> None:
    db_path = tmp_path / "result.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    repo = ConversationRepository()
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=v1._hash_api_key("secret"),
            idempotency_key="result-key",
            status="completed",
            config={},
        )
    async with session_factory() as session:
        await repo.update_agent_run(
            session,
            run.id,
            status="completed",
            result={"message": "hello <world>"},
        )
        completed = await repo.get_agent_run(session, run.id)
        assert completed is not None

        state = SimpleNamespace(db_repo=repo)
        auth = v1.IntegrationAuth(api_key_hash=v1._hash_api_key("secret"))
        text_response = await v1.get_agent_run_result(
            str(run.id),
            result_format="text",
            session=session,
            state=state,
            auth=auth,
        )
        html_response = await v1.get_agent_run_result(
            str(run.id),
            result_format="html",
            session=session,
            state=state,
            auth=auth,
        )

    assert isinstance(text_response, PlainTextResponse)
    assert text_response.body == b"hello <world>"
    assert isinstance(html_response, HTMLResponse)
    assert b"hello &lt;world&gt;" in html_response.body

    await engine.dispose()


@pytest.mark.asyncio
async def test_public_event_generator_filters_live_events_until_requested_run(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=v1._hash_api_key("secret"),
            idempotency_key="live-filter",
            status="running",
            config={},
        )

    emitter = EventEmitter(conversation_id=str(convo.id))
    state.conversations[str(convo.id)] = ConversationEntry(
        emitter=emitter,
        event_queue=asyncio.Queue(),
        orchestrator=object(),
        executor=object(),
        pending_callbacks={},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )

    async def collect() -> list[str]:
        chunks: list[str] = []
        async for chunk in v1._public_event_generator(state, run):
            chunks.append(chunk)
            if "event: done" in chunk:
                break
        return chunks

    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)
    await emitter.emit(EventType.TEXT_DELTA, {"delta": "wrong turn"})
    await emitter.emit(
        EventType.TURN_START,
        {"run_id": str(run.id), "message": "right"},
    )
    await emitter.emit(EventType.TEXT_DELTA, {"delta": "right turn"})
    await emitter.emit(EventType.TURN_COMPLETE, {"result": "done"})
    chunks = await asyncio.wait_for(task, timeout=1)

    joined = "".join(chunks)
    assert "wrong turn" not in joined
    assert "right turn" in joined
    assert "event: run.completed" in joined

    await engine.dispose()


@pytest.mark.asyncio
async def test_public_event_generator_finishes_when_terminal_status_is_missed(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=v1._hash_api_key("secret"),
            idempotency_key="missed-terminal",
            status="running",
            config={},
        )
    async with session_factory() as session:
        await repo.update_agent_run(session, run.id, status="completed")

    state.conversations[str(convo.id)] = ConversationEntry(
        emitter=EventEmitter(conversation_id=str(convo.id)),
        event_queue=asyncio.Queue(),
        orchestrator=object(),
        executor=object(),
        pending_callbacks={},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )

    chunks: list[str] = []
    async for chunk in v1._public_event_generator(state, run):
        chunks.append(chunk)
        if "event: done" in chunk:
            break

    assert chunks[-1] == "event: done\ndata: {}\n\n"
    await engine.dispose()


@pytest.mark.asyncio
async def test_create_conversation_message_rejects_active_run_without_new_row(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            idempotency_key="owner",
            status="completed",
            config={"operation": "create"},
        )

    active_task = asyncio.create_task(asyncio.sleep(10))
    state.conversations[str(convo.id)] = ConversationEntry(
        emitter=EventEmitter(conversation_id=str(convo.id)),
        event_queue=asyncio.Queue(),
        orchestrator=object(),
        executor=object(),
        pending_callbacks={},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )
    state.conversations[str(convo.id)].turn_task = active_task

    with pytest.raises(HTTPException) as exc_info:
        await v1.create_conversation_message(
            v1.AgentMessageCreateRequest(message="next"),
            SimpleNamespace(cookies={}),
            conversation_id=str(convo.id),
            idempotency_header="next-key",
            state=state,
            auth=v1.IntegrationAuth(api_key_hash=api_hash),
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["error"]["code"] == "run_in_progress"
    async with session_factory() as session:
        count = (
            (
                await session.execute(
                    select(AgentRunModel).where(
                        AgentRunModel.conversation_id == convo.id
                    )
                )
            )
            .scalars()
            .all()
        )
    assert len(count) == 1
    active_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await active_task
    await engine.dispose()


@pytest.mark.asyncio
async def test_idempotency_key_reuse_with_different_payload_conflicts(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state, engine, _ = await _make_state(tmp_path)

    def _fake_start_turn_task(entry, coro, *, idempotency_key=None):
        del entry, idempotency_key
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return SimpleNamespace(done=lambda: False, cancel=lambda: None)

    monkeypatch.setattr(v1, "_start_turn_task", _fake_start_turn_task)
    auth = v1.IntegrationAuth(api_key_hash=v1._hash_api_key("secret"))
    request = SimpleNamespace(cookies={})

    await v1.create_agent_run(
        v1.AgentRunCreateRequest(message="hello"),
        request,
        idempotency_header="same-key",
        state=state,
        auth=auth,
    )

    with pytest.raises(HTTPException) as exc_info:
        await v1.create_agent_run(
            v1.AgentRunCreateRequest(message="different"),
            request,
            idempotency_header="same-key",
            state=state,
            auth=auth,
        )

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["error"]["code"] == "idempotency_conflict"
    await engine.dispose()


@pytest.mark.asyncio
async def test_idempotent_create_integrity_race_cleans_losing_conversation(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    delegate = state.db_repo
    api_hash = v1._hash_api_key("secret")
    body = v1.AgentRunCreateRequest(message="hello")
    fingerprint = v1._request_fingerprint(operation="create", body=body)
    async with session_factory() as session:
        existing_convo = await delegate.create_conversation(session, title="existing")
    async with session_factory() as session:
        existing = await delegate.create_agent_run(
            session,
            conversation_id=existing_convo.id,
            api_key_hash=api_hash,
            idempotency_key="race-key",
            status="queued",
            config=v1._run_config(
                operation="create",
                body=body,
                request_fingerprint=fingerprint,
            ),
        )

    class RacingRepository:
        def __init__(self) -> None:
            self.lookup_count = 0
            self.created_conversation_id = None

        async def get_agent_run_by_idempotency(self, *args, **kwargs):
            self.lookup_count += 1
            if self.lookup_count == 1:
                return None
            return await delegate.get_agent_run_by_idempotency(*args, **kwargs)

        async def create_conversation(self, *args, **kwargs):
            created = await delegate.create_conversation(*args, **kwargs)
            self.created_conversation_id = created.id
            return created

        async def create_agent_run(self, *args, **kwargs):
            raise IntegrityError("insert", {}, Exception("duplicate"))

        async def delete_conversation(self, *args, **kwargs):
            return await delegate.delete_conversation(*args, **kwargs)

    racing_repo = RacingRepository()
    state.db_repo = racing_repo

    response = await v1.create_agent_run(
        body,
        SimpleNamespace(cookies={}),
        idempotency_header="race-key",
        state=state,
        auth=v1.IntegrationAuth(api_key_hash=api_hash),
    )

    assert response.run_id == str(existing.id)
    assert racing_repo.created_conversation_id is not None
    async with session_factory() as session:
        losing_convo = await delegate.get_conversation(
            session,
            racing_repo.created_conversation_id,
        )
    assert losing_convo is None
    assert str(racing_repo.created_conversation_id) not in state.conversations
    await engine.dispose()


@pytest.mark.asyncio
async def test_v1_rate_limiter_returns_public_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "1")
    get_settings.cache_clear()
    auth = v1.IntegrationAuth(api_key_hash=v1._hash_api_key("secret"))

    assert await v1.require_v1_rate_limit(auth) == auth
    with pytest.raises(HTTPException) as exc_info:
        await v1.require_v1_rate_limit(auth)

    assert exc_info.value.status_code == 429
    assert exc_info.value.detail["error"]["code"] == "rate_limited"


@pytest.mark.asyncio
async def test_v1_artifacts_are_listed_downloaded_and_included_in_result(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            idempotency_key="artifact-run",
            status="completed",
            config={},
        )
    artifact_id = "a" * 32
    await state.storage_backend.save(
        f"{artifact_id}.txt",
        b"artifact body",
        "text/plain",
    )
    async with session_factory() as session:
        await repo.save_artifact(
            session,
            artifact_id=artifact_id,
            conversation_id=convo.id,
            storage_key=f"{artifact_id}.txt",
            original_name="result.txt",
            content_type="text/plain",
            size=13,
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "turn_start",
            {"run_id": str(run.id), "message": "hello"},
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "artifact_created",
            {
                "artifact_id": artifact_id,
                "name": "result.txt",
                "content_type": "text/plain",
                "size": 13,
            },
        )
    async with session_factory() as session:
        await repo.save_event(
            session,
            convo.id,
            "turn_complete",
            {"result": "done", "artifact_ids": [artifact_id]},
        )
    async with session_factory() as session:
        await repo.update_agent_run(session, run.id, result={"message": "done"})

    auth = v1.IntegrationAuth(api_key_hash=api_hash)
    async with session_factory() as session:
        result_response = await v1.get_agent_run_result(
            str(run.id),
            result_format="json",
            session=session,
            state=state,
            auth=auth,
        )
        artifact_list = await v1.list_conversation_artifacts(
            str(convo.id),
            session=session,
            state=state,
            auth=auth,
        )
        file_response = await v1.get_conversation_artifact(
            str(convo.id),
            artifact_id,
            session=session,
            state=state,
            auth=auth,
        )

    assert json.loads(result_response.body)["artifact_ids"] == [artifact_id]
    assert artifact_list.artifacts[0].id == artifact_id
    assert isinstance(file_response, FileResponse)

    other_auth = v1.IntegrationAuth(api_key_hash=v1._hash_api_key("other"))
    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc_info:
            await v1.list_conversation_artifacts(
                str(convo.id),
                session=session,
                state=state,
                auth=other_auth,
            )
    assert exc_info.value.status_code == 404
    await engine.dispose()


@pytest.mark.asyncio
async def test_v1_input_required_event_and_response_endpoint(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            idempotency_key="prompt-run",
            status="running",
            config={},
        )

    payload = v1._public_event_payload(
        event_type="ask_user",
        data={
            "request_id": "req_1",
            "question": "Continue?",
            "prompt_kind": "choice",
            "title": "Confirm",
            "options": [{"label": "Yes"}],
            "prompt_metadata": {"source": "test"},
        },
        timestamp=123.0,
        iteration=None,
        run_id="run_1",
        conversation_id=str(convo.id),
    )
    assert payload is not None
    assert payload["event_type"] == "input.required"
    assert payload["data"]["request_id"] == "req_1"

    class FakeCoordinator:
        async def submit_response(self, *, conversation_id, request_id, response):
            assert conversation_id == str(convo.id)
            assert request_id == "req_1"
            assert response == "yes"
            return SubmitResponseResult(SubmitResponseStatus.FULFILLED)

    emitted: list[AgentEvent] = []
    emitter = EventEmitter(conversation_id=str(convo.id))

    async def _capture(event: AgentEvent) -> None:
        emitted.append(event)

    emitter.subscribe(_capture)
    state.conversations[str(convo.id)] = ConversationEntry(
        emitter=emitter,
        event_queue=asyncio.Queue(),
        orchestrator=object(),
        executor=object(),
        pending_callbacks={"req_1": object()},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )
    state.response_coordinator = FakeCoordinator()

    response = await v1.respond_to_prompt(
        UserInputRequest(request_id="req_1", response="yes"),
        conversation_id=str(convo.id),
        state=state,
        auth=v1.IntegrationAuth(api_key_hash=api_hash),
    )

    assert response == {"status": "ok"}
    assert emitted[-1].type == EventType.USER_RESPONSE
    assert "req_1" not in state.conversations[str(convo.id)].pending_callbacks
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancel_agent_run_rejects_other_api_key(tmp_path) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            status="running",
            config={},
        )

    async with session_factory() as session:
        with pytest.raises(HTTPException) as exc_info:
            await v1.cancel_agent_run(
                str(run.id),
                session=session,
                state=state,
                auth=v1.IntegrationAuth(api_key_hash=v1._hash_api_key("other")),
            )

    assert exc_info.value.status_code == 404
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancel_agent_run_noops_for_terminal_run(tmp_path) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            status="completed",
            config={},
        )
        await repo.update_agent_run(session, run.id, result={"message": "done"})

    async with session_factory() as session:
        response = await v1.cancel_agent_run(
            str(run.id),
            session=session,
            state=state,
            auth=v1.IntegrationAuth(api_key_hash=api_hash),
        )

    assert response == {"status": "already_terminal"}
    async with session_factory() as session:
        fresh = await repo.get_agent_run(session, run.id)
    assert fresh is not None
    assert fresh.status == "completed"
    await engine.dispose()


@pytest.mark.asyncio
async def test_cancel_agent_run_signals_active_turn_and_marks_cancelled(
    tmp_path,
) -> None:
    state, engine, session_factory = await _make_state(tmp_path)
    repo = state.db_repo
    api_hash = v1._hash_api_key("secret")
    async with session_factory() as session:
        convo = await repo.create_conversation(session, title="test")
    async with session_factory() as session:
        run = await repo.create_agent_run(
            session,
            conversation_id=convo.id,
            api_key_hash=api_hash,
            status="running",
            config={},
        )

    turn_task = asyncio.create_task(asyncio.sleep(10))

    class CancellableOrchestrator:
        cancelled = False

        def cancel(self) -> None:
            self.cancelled = True
            turn_task.cancel()

    orchestrator = CancellableOrchestrator()
    state.conversations[str(convo.id)] = ConversationEntry(
        emitter=EventEmitter(conversation_id=str(convo.id)),
        event_queue=asyncio.Queue(),
        orchestrator=orchestrator,
        executor=object(),
        pending_callbacks={},
        orchestrator_mode=ORCHESTRATOR_AGENT,
    )
    state.conversations[str(convo.id)].turn_task = turn_task

    async with session_factory() as session:
        response = await v1.cancel_agent_run(
            str(run.id),
            session=session,
            state=state,
            auth=v1.IntegrationAuth(api_key_hash=api_hash),
        )

    assert response == {"status": "cancelling"}
    assert orchestrator.cancelled is True
    with contextlib.suppress(asyncio.CancelledError):
        await turn_task

    for _ in range(20):
        async with session_factory() as session:
            fresh = await repo.get_agent_run(session, run.id)
        if fresh is not None and fresh.status == "cancelled":
            break
        await asyncio.sleep(0.01)

    assert fresh is not None
    assert fresh.status == "cancelled"
    assert fresh.error == {"code": "cancelled", "message": "Run was cancelled."}
    await engine.dispose()


def test_public_event_payload_maps_turn_cancelled_to_cancelled_run() -> None:
    payload = v1._public_event_payload(
        event_type="turn_cancelled",
        data={"result": "Turn was cancelled."},
        timestamp=123.0,
        iteration=None,
        run_id="run_1",
        conversation_id="conv_1",
    )

    assert payload is not None
    assert payload["event_type"] == "run.cancelled"
    assert payload["data"]["error"]["code"] == "cancelled"
