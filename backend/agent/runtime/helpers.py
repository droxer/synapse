"""Shared helpers for agent loop orchestrators."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from loguru import logger

from agent.llm.client import LLMResponse, ToolCall
from agent.tools.base import ToolResult
from agent.tools.executor import ToolExecutor
from api.events import EventEmitter, EventType
from config.settings import get_settings

if TYPE_CHECKING:
    from agent.runtime.orchestrator import AgentState


@dataclass(frozen=True)
class ToolCallProcessingResult:
    """Immutable result of processing a batch of tool calls."""

    state: AgentState
    processed_count: int
    artifact_ids: tuple[str, ...] = ()


def apply_response_to_state(state: AgentState, response: LLMResponse) -> AgentState:
    """Add the assistant message (text + tool_use blocks) to state.

    Returns an unchanged state when the response carries no content.
    """
    content_blocks: list[dict[str, Any]] = []

    if response.text:
        content_blocks.append({"type": "text", "text": response.text})

    for tc in response.tool_calls:
        content_blocks.append(
            {"type": "tool_use", "id": tc.id, "name": tc.name, "input": tc.input},
        )

    if not content_blocks:
        return state

    return state.add_message({"role": "assistant", "content": content_blocks})


def build_tool_result_block(
    tool_use_id: str,
    output: str,
    success: bool,
    screenshot_base64: str | None = None,
) -> dict[str, Any]:
    """Build a single tool_result content block, optionally with screenshot."""
    content: list[dict[str, Any]] = []

    if output:
        content.append({"type": "text", "text": output})

    if screenshot_base64:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": screenshot_base64,
                },
            }
        )

    block: dict[str, Any] = {
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content if content else output,
    }
    if not success:
        block["is_error"] = True
    return block


def extract_final_text(state: AgentState) -> str:
    """Extract the final assistant text from the completed state."""
    for msg in reversed(state.messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [b["text"] for b in content if b.get("type") == "text"]
            if texts:
                return "".join(texts)
    return ""


def extract_final_text_from_messages(messages: tuple[dict[str, Any], ...]) -> str:
    """Extract the final assistant text from a raw message tuple."""
    for msg in reversed(messages):
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = [b["text"] for b in content if b.get("type") == "text"]
            if texts:
                return "".join(texts)
    return ""


def extract_user_message_text(message: dict[str, Any]) -> str | None:
    """Return conversational user text, skipping synthetic tool-result messages."""
    if message.get("role") != "user":
        return None

    content = message.get("content")
    if isinstance(content, str):
        text = content.strip()
        return text or None

    if not isinstance(content, list):
        return None

    if any(
        isinstance(block, dict) and block.get("type") == "tool_result"
        for block in content
    ):
        return None

    texts = [
        block.get("text", "")
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    combined = "".join(texts).strip()
    return combined or None


def get_last_user_message_text(messages: tuple[dict[str, Any], ...]) -> str | None:
    """Return the most recent conversational user message text."""
    for message in reversed(messages):
        text = extract_user_message_text(message)
        if text is not None:
            return text
    return None


def find_last_user_message_index(messages: tuple[dict[str, Any], ...]) -> int | None:
    """Return the index of the most recent conversational user message."""
    for index in range(len(messages) - 1, -1, -1):
        if extract_user_message_text(messages[index]) is not None:
            return index
    return None


# Local tools that are safe to run concurrently (no shared sandbox mutation).
_PARALLEL_SAFE_TOOL_NAMES = frozenset({"web_search", "memory_list", "memory_search"})


def _tool_batch_allows_parallel_execution(tool_calls: tuple[ToolCall, ...]) -> bool:
    return len(tool_calls) >= 2 and all(
        tc.name in _PARALLEL_SAFE_TOOL_NAMES for tc in tool_calls
    )


def _resolve_tool_call_event_payload(
    executor: Any,
    tool_name: str,
    tool_input: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Return the canonical tool call payload when supported by the executor."""
    resolver = getattr(executor, "canonical_tool_call_event_payload", None)
    if callable(resolver):
        return resolver(tool_name, tool_input)
    return tool_name, tool_input


async def _emit_and_execute_single_tool(
    state: AgentState,
    tc: ToolCall,
    executor: ToolExecutor,
    emitter: EventEmitter,
    agent_id: str | None,
) -> tuple[ToolResult, dict[str, Any]]:
    """Run one tool after emitting TOOL_CALL; return (ToolResult, result_data dict)."""
    event_tool_name, event_tool_input = _resolve_tool_call_event_payload(
        executor,
        tc.name,
        tc.input,
    )
    event_data: dict[str, Any] = {
        "tool_name": event_tool_name,
        "tool_input": event_tool_input,
        "tool_id": tc.id,
    }
    if agent_id is not None:
        event_data["agent_id"] = agent_id

    await emitter.emit(
        EventType.TOOL_CALL,
        event_data,
        iteration=state.iteration,
    )

    result = await executor.execute(tc.name, tc.input)
    output = result.output if result.success else (result.error or "Unknown error")

    logger.info("tool_result name={} success={}", tc.name, result.success)

    result_data: dict[str, Any] = {
        "tool_id": tc.id,
        "success": result.success,
        "output": output,
    }
    if result.metadata:
        if "artifact_ids" in result.metadata:
            result_data["artifact_ids"] = list(result.metadata["artifact_ids"])
        if "content_type" in result.metadata:
            result_data["content_type"] = result.metadata["content_type"]
        for key in ("steps", "is_done", "max_steps", "url", "task"):
            if key in result.metadata:
                result_data[key] = result.metadata[key]
        for key in ("action", "x", "y", "text", "end_x", "end_y", "amount"):
            if key in result.metadata:
                result_data[key] = result.metadata[key]
    if agent_id is not None:
        result_data["agent_id"] = agent_id

    await emitter.emit(
        EventType.TOOL_RESULT,
        result_data,
        iteration=state.iteration,
    )
    return result, result_data


async def _emit_skipped_tool_result(
    state: AgentState,
    tc: ToolCall,
    emitter: EventEmitter,
    reason: str,
    agent_id: str | None,
) -> dict[str, Any]:
    """Emit a synthetic TOOL_RESULT for an unexecuted tool call."""
    result_data: dict[str, Any] = {
        "tool_id": tc.id,
        "success": False,
        "output": reason,
    }
    if agent_id is not None:
        result_data["agent_id"] = agent_id

    await emitter.emit(
        EventType.TOOL_RESULT,
        result_data,
        iteration=state.iteration,
    )
    return build_tool_result_block(tc.id, reason, False)


async def process_tool_calls(
    state: AgentState,
    tool_calls: tuple[ToolCall, ...],
    executor: ToolExecutor,
    emitter: EventEmitter,
    agent_id: str | None = None,
    stop_check: Callable[[], bool] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    post_tool_callback: Callable[[ToolCall, ToolResult], Awaitable[None]] | None = None,
) -> ToolCallProcessingResult:
    """Execute each tool call and add results to state.

    Args:
        state: Current agent state (must expose ``.iteration`` and
               ``.add_message()``).
        tool_calls: Tuple of tool calls returned by the LLM.
        executor: Executor used to dispatch each call.
        emitter: Event emitter for TOOL_CALL / TOOL_RESULT events.
        agent_id: Optional agent identifier included in emitted events.
        stop_check: Optional zero-argument callable; when it returns
                    ``True`` the loop stops processing further tool calls
                    (e.g. because ``task_complete`` was already triggered).

    Returns:
        New state with a single user message containing all tool results
        collected up to the stop point.
    """
    tool_results: list[dict[str, Any]] = []
    artifact_ids: list[str] = []
    processed_count = 0

    if (
        get_settings().PARALLEL_SAFE_TOOLS_ENABLED
        and _tool_batch_allows_parallel_execution(tool_calls)
    ):
        logger.info(
            "executing_tools_parallel count={} names={}",
            len(tool_calls),
            [tc.name for tc in tool_calls],
        )

        emit_tasks = []
        for tc in tool_calls:
            event_tool_name, event_tool_input = _resolve_tool_call_event_payload(
                executor,
                tc.name,
                tc.input,
            )
            emit_tasks.append(
                emitter.emit(
                    EventType.TOOL_CALL,
                    {
                        "tool_name": event_tool_name,
                        "tool_input": event_tool_input,
                        "tool_id": tc.id,
                        **({"agent_id": agent_id} if agent_id is not None else {}),
                    },
                    iteration=state.iteration,
                )
            )
        await asyncio.gather(*emit_tasks)

        exec_tasks = [executor.execute(tc.name, tc.input) for tc in tool_calls]
        parallel_results = await asyncio.gather(*exec_tasks)

        for tc, result in zip(tool_calls, parallel_results, strict=True):
            processed_count += 1
            output = (
                result.output if result.success else (result.error or "Unknown error")
            )
            logger.info("tool_result name={} success={}", tc.name, result.success)

            result_data: dict[str, Any] = {
                "tool_id": tc.id,
                "success": result.success,
                "output": output,
            }
            if result.metadata:
                if "artifact_ids" in result.metadata:
                    new_artifact_ids = list(result.metadata["artifact_ids"])
                    result_data["artifact_ids"] = new_artifact_ids
                    artifact_ids.extend(new_artifact_ids)
                if "content_type" in result.metadata:
                    result_data["content_type"] = result.metadata["content_type"]
                for key in ("steps", "is_done", "max_steps", "url", "task"):
                    if key in result.metadata:
                        result_data[key] = result.metadata[key]
                for key in ("action", "x", "y", "text", "end_x", "end_y", "amount"):
                    if key in result.metadata:
                        result_data[key] = result.metadata[key]
            if agent_id is not None:
                result_data["agent_id"] = agent_id

            await emitter.emit(
                EventType.TOOL_RESULT,
                result_data,
                iteration=state.iteration,
            )

            screenshot_base64 = None
            if result.metadata and "screenshot_base64" in result.metadata:
                screenshot_base64 = result.metadata["screenshot_base64"]

            tool_results.append(
                build_tool_result_block(
                    tc.id, output, result.success, screenshot_base64=screenshot_base64
                ),
            )
            if post_tool_callback is not None:
                await post_tool_callback(tc, result)

        return ToolCallProcessingResult(
            state=state.add_message({"role": "user", "content": tool_results}),
            processed_count=processed_count,
            artifact_ids=tuple(artifact_ids),
        )

    for tc in tool_calls:
        break_reason: str | None = None
        logger.info("executing_tool name={}", tc.name)

        result, _ = await _emit_and_execute_single_tool(
            state, tc, executor, emitter, agent_id
        )
        processed_count += 1
        output = result.output if result.success else (result.error or "Unknown error")

        if result.metadata and "artifact_ids" in result.metadata:
            artifact_ids.extend(list(result.metadata["artifact_ids"]))

        screenshot_base64 = None
        if result.metadata and "screenshot_base64" in result.metadata:
            screenshot_base64 = result.metadata["screenshot_base64"]

        tool_results.append(
            build_tool_result_block(
                tc.id, output, result.success, screenshot_base64=screenshot_base64
            ),
        )
        if post_tool_callback is not None:
            await post_tool_callback(tc, result)

        # Break early when task_complete (or any other stop condition) fires
        if stop_check is not None and stop_check():
            break_reason = (
                "Tool call skipped because the task was already marked complete."
            )
        elif cancel_check is not None and cancel_check():
            break_reason = "Tool call skipped because the turn was cancelled."

        if break_reason is not None:
            remaining_calls = tool_calls[processed_count:]
            for skipped_tc in remaining_calls:
                tool_results.append(
                    await _emit_skipped_tool_result(
                        state,
                        skipped_tc,
                        emitter,
                        break_reason,
                        agent_id,
                    )
                )
            break

    return ToolCallProcessingResult(
        state=state.add_message({"role": "user", "content": tool_results}),
        processed_count=processed_count,
        artifact_ids=tuple(artifact_ids),
    )
