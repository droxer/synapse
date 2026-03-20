"""Shared helpers for agent loop orchestrators."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

from loguru import logger

from agent.llm.client import LLMResponse, ToolCall
from agent.tools.executor import ToolExecutor
from api.events import EventEmitter, EventType

if TYPE_CHECKING:
    from agent.runtime.orchestrator import AgentState


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


async def process_tool_calls(
    state: AgentState,
    tool_calls: tuple[ToolCall, ...],
    executor: ToolExecutor,
    emitter: EventEmitter,
    agent_id: str | None = None,
    stop_check: Callable[[], bool] | None = None,
    cancel_check: Callable[[], bool] | None = None,
) -> AgentState:
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

    for tc in tool_calls:
        logger.info("executing_tool name={}", tc.name)

        event_data: dict[str, Any] = {
            "tool_name": tc.name,
            "tool_input": tc.input,
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
        # Forward artifact_ids and content_type from tool metadata
        if result.metadata:
            if "artifact_ids" in result.metadata:
                result_data["artifact_ids"] = list(result.metadata["artifact_ids"])
            if "content_type" in result.metadata:
                result_data["content_type"] = result.metadata["content_type"]
            # Forward browser-specific metadata fields
            for key in ("steps", "is_done", "max_steps", "url", "task"):
                if key in result.metadata:
                    result_data[key] = result.metadata[key]
            # Forward computer_use-specific metadata fields
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

        # Break early when task_complete (or any other stop condition) fires
        if stop_check is not None and stop_check():
            break

        # Break early when cancellation is requested
        if cancel_check is not None and cancel_check():
            break

    return state.add_message({"role": "user", "content": tool_results})
