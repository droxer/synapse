"""Single-agent ReAct loop orchestrator."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from uuid import uuid4

from loguru import logger

from agent.llm.client import (
    AnthropicClient,
    SystemPrompt,
    format_llm_failure,
    is_content_policy_error,
    render_system_prompt,
)
from agent.runtime.prompting import PromptAssembly
from agent.context.profiles import CompactionProfile, resolve_compaction_profile
from agent.memory.compaction_flush import flush_heuristic_facts_from_messages
from agent.memory.store import PersistentMemoryStore
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    extract_final_text_from_messages,
    find_last_user_message_index,
    get_last_user_message_text,
    process_tool_calls,
)
from agent.runtime.message_chain import (
    collect_message_chain_warnings,
    tool_calls_fingerprint,
)
from agent.context.compaction import Observer, compaction_summary_for_persistence
from agent.runtime.skill_install import install_skill_dependencies_for_turn
from agent.runtime.skill_runtime import split_allowed_tools
from agent.runtime.skill_setup import (
    build_skill_prompt_content,
    emit_redundant_skill_activation,
    prepare_skill_for_turn,
    tool_use_had_error_result,
)
from agent.runtime.skill_selector import select_skill_for_message
from agent.runtime.turn_attachments import (
    build_user_message_content,
    upload_attachments_to_sandbox,
)
from agent.runtime.skill_selector import AttachmentDescriptor
from agent.skills.loader import SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from api.models import serialize_attachment_metadata
from config.settings import get_settings

_DEBUG_LOG_PATH = Path("/Users/feihe/Workspace/Synapse/.cursor/debug-caca61.log")
_DEBUG_SESSION_ID = "caca61"


def _emit_debug_log(
    *,
    run_id: str,
    hypothesis_id: str,
    location: str,
    message: str,
    data: dict[str, Any],
) -> None:
    payload = {
        "sessionId": _DEBUG_SESSION_ID,
        "id": f"log_{uuid4().hex}",
        "timestamp": int(time.time() * 1000),
        "runId": run_id,
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
    }
    try:
        _DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with _DEBUG_LOG_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, ensure_ascii=True) + "\n")
    except Exception:
        return


@dataclass(frozen=True)
class AgentState:
    """Immutable state of an agent execution loop.

    All mutation methods return a new AgentState instance,
    leaving the original unchanged.
    """

    messages: tuple[dict[str, Any], ...] = ()
    iteration: int = 0
    completed: bool = False
    error: str | None = None

    def add_message(self, message: dict[str, Any]) -> AgentState:
        """Return new state with message appended."""
        return replace(self, messages=(*self.messages, message))

    def increment_iteration(self) -> AgentState:
        """Return new state with iteration incremented by one."""
        return replace(self, iteration=self.iteration + 1)

    def mark_completed(self, summary: str | None = None) -> AgentState:
        """Return new state marked as completed, optionally appending a summary."""
        messages = self.messages
        if summary is not None:
            final_msg: dict[str, Any] = {"role": "assistant", "content": summary}
            messages = (*messages, final_msg)
        return replace(self, messages=messages, completed=True)

    def mark_error(self, error: str) -> AgentState:
        """Return new state marked as failed with an error message."""
        return replace(self, error=error)


class AgentOrchestrator:
    """Runs a single-agent ReAct loop until completion or max iterations."""

    def __init__(
        self,
        claude_client: AnthropicClient,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        event_emitter: EventEmitter,
        system_prompt: str,
        max_iterations: int = 50,
        observer: Observer | None = None,
        compaction_profile: CompactionProfile | None = None,
        initial_messages: tuple[dict[str, Any], ...] = (),
        thinking_budget: int = 0,
        skill_registry: SkillRegistry | None = None,
        persistent_store: PersistentMemoryStore | None = None,
    ) -> None:
        if not system_prompt:
            raise ValueError("system_prompt must not be empty")
        settings = get_settings()
        self._client = claude_client
        self._base_registry = tool_registry
        self._executor = tool_executor
        self._emitter = event_emitter
        self._system_prompt = system_prompt
        self._max_iterations = max_iterations
        resolved_profile = compaction_profile or resolve_compaction_profile(
            settings, "web_conversation"
        )
        self._observer = observer or Observer(
            profile=resolved_profile,
            claude_client=claude_client,
            summary_model=resolved_profile.summary_model or settings.LITE_MODEL,
        )
        self._compaction_profile = (
            getattr(observer, "profile", resolved_profile)
            if observer is not None
            else resolved_profile
        )
        self._persistent_store = persistent_store
        self._thinking_budget = thinking_budget
        self._task_complete_summary: str | None = None
        self._cancel_event = asyncio.Event()
        self._state = AgentState(messages=initial_messages)
        self._skill_registry = skill_registry
        self._auto_injected_skill: str | None = None
        self._run_lock = asyncio.Lock()
        self._last_tool_batch_signature: str | None = None
        self._identical_tool_batch_count: int = 0
        self._turn_artifact_ids: list[str] = []
        self._turn_prompt_assembly = PromptAssembly.from_system(system_prompt)
        self._turn_unfiltered_registry = tool_registry
        self._pending_mid_turn_update: (
            tuple[PromptAssembly, ToolRegistry, list[dict[str, Any]]] | None
        ) = None
        self._processed_skill_activation_tool_ids: set[str] = set()
        self._current_turn_start_index = len(initial_messages)

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary

    def cancel(self) -> None:
        """Signal the current turn to stop."""
        self._cancel_event.set()

    def reset_cancel(self) -> None:
        """Clear the cancellation signal."""
        self._cancel_event.clear()

    def get_last_user_message(self) -> str | None:
        """Return the content of the most recent user message, or None."""
        return get_last_user_message_text(self._state.messages)

    def rollback_to_before_last_user_message(self) -> None:
        """Remove the last user message and everything after it."""
        index = find_last_user_message_index(self._state.messages)
        if index is None:
            return
        self._state = replace(
            self._state,
            messages=self._state.messages[:index],
            completed=False,
            error=None,
        )

    def _requested_skill_name_from_tool_call(
        self, tool_call_name: str, tool_input: dict[str, Any]
    ) -> str | None:
        if self._skill_registry is None:
            return None
        if tool_call_name == "activate_skill":
            name = tool_input.get("name")
            return name if isinstance(name, str) and name else None
        if self._skill_registry.find_by_name(tool_call_name) is not None:
            return tool_call_name
        return None

    async def _apply_mid_turn_skill_activation(
        self,
        skill_name: str,
        *,
        tool_id: str | None,
    ) -> tuple[PromptAssembly, ToolRegistry, list[dict[str, Any]]] | None:
        if self._skill_registry is None:
            return None

        if tool_id is not None and tool_id in self._processed_skill_activation_tool_ids:
            return None

        if skill_name == self._auto_injected_skill:
            await emit_redundant_skill_activation(
                self._emitter,
                skill_name=skill_name,
                tool_id=tool_id,
                messages=list(self._state.messages),
            )
            if tool_id is not None:
                self._processed_skill_activation_tool_ids.add(tool_id)
            return None

        skill = self._skill_registry.find_by_name(skill_name)
        if skill is None:
            return None

        self._auto_injected_skill = skill.metadata.name
        prompt_assembly = self._turn_prompt_assembly.with_volatile_sections(
            build_skill_prompt_content(skill),
        )

        from agent.tools.local.activate_skill import ActivateSkill

        updated_registry = self._turn_unfiltered_registry.replace_tool(
            ActivateSkill(
                skill_registry=self._skill_registry,
                active_skill_name=skill.metadata.name,
            )
        )

        reset_allowed_tools = getattr(self._executor, "reset_allowed_tools", None)
        if callable(reset_allowed_tools):
            reset_allowed_tools()

        await prepare_skill_for_turn(
            executor=self._executor,
            skill=skill,
            emitter=self._emitter,
            source="mid_turn",
            install_dependencies=lambda: install_skill_dependencies_for_turn(
                self._executor,
                skill.metadata.dependencies,
                self._emitter,
                context="orchestrator_mid_turn",
                skill_name=skill.metadata.name,
                source="mid_turn",
                raise_on_error=True,
            ),
        )

        if skill.metadata.allowed_tools:
            allowed_names, allowed_tags = split_allowed_tools(
                skill.metadata.allowed_tools
            )
            set_allowed_tools = getattr(self._executor, "set_allowed_tools", None)
            if callable(set_allowed_tools):
                set_allowed_tools(allowed_names, allowed_tags)
            updated_registry = updated_registry.filter_by_names_or_tags(
                allowed_names, allowed_tags
            )

        tools = updated_registry.to_anthropic_tools(
            cache_breakpoint=getattr(get_settings(), "PROMPT_CACHE_ENABLED", False)
        )
        if tool_id is not None:
            self._processed_skill_activation_tool_ids.add(tool_id)

        logger.info("mid_turn_skill_activated name={}", skill.metadata.name)
        return prompt_assembly, updated_registry, tools

    @staticmethod
    def _append_text_guard_to_last_user_message(
        state: AgentState,
        extra_text: str,
    ) -> AgentState:
        """Append a text guard/nudge to the last user message when possible."""
        if not state.messages:
            return state.add_message({"role": "user", "content": extra_text})
        msgs = list(state.messages)
        last = msgs[-1]
        if last.get("role") != "user":
            return state.add_message({"role": "user", "content": extra_text})
        content = last.get("content")
        if isinstance(content, str):
            msgs[-1] = {**last, "content": f"{content}\n\n{extra_text}"}
        elif isinstance(content, list):
            msgs[-1] = {
                **last,
                "content": [
                    *content,
                    {"type": "text", "text": extra_text},
                ],
            }
        else:
            return state.add_message({"role": "user", "content": extra_text})
        return replace(state, messages=tuple(msgs))

    async def _emit_task_error(
        self,
        message: str,
        *,
        code: str = "agent_error",
        retryable: bool = False,
    ) -> None:
        await self._emitter.emit(
            EventType.TASK_ERROR,
            {"error": message, "code": code, "retryable": retryable},
        )

    # NOTE: concurrent run() calls are serialized via ``_run_lock``.
    async def run(
        self,
        user_message: str,
        attachments: tuple[Any, ...] = (),
        selected_skills: tuple[str, ...] = (),
        runtime_prompt_sections: tuple[str, ...] = (),
        turn_metadata: dict[str, Any] | None = None,
    ) -> str:
        """Execute the agent loop and return the final text response."""
        if not user_message.strip():
            raise ValueError("user_message must not be empty")

        async with self._run_lock:
            return await self._run_locked(
                user_message=user_message,
                attachments=attachments,
                selected_skills=selected_skills,
                runtime_prompt_sections=runtime_prompt_sections,
                turn_metadata=turn_metadata,
            )

    async def _run_locked(
        self,
        *,
        user_message: str,
        attachments: tuple[Any, ...],
        selected_skills: tuple[str, ...],
        runtime_prompt_sections: tuple[str, ...],
        turn_metadata: dict[str, Any] | None,
    ) -> str:
        logger.info("turn_start user_message_length={}", len(user_message))

        await self._emitter.emit(
            EventType.TURN_START,
            {
                "message": user_message,
                "attachments": serialize_attachment_metadata(attachments),
                "orchestrator_mode": "agent",
                **(turn_metadata or {}),
            },
        )

        self._executor.reset_turn_quotas()
        self._executor.reset_sandbox_template()
        reset_allowed_tools = getattr(self._executor, "reset_allowed_tools", None)
        if callable(reset_allowed_tools):
            reset_allowed_tools()
        reset_active_skill_directory = getattr(
            self._executor, "reset_active_skill_directory", None
        )
        if callable(reset_active_skill_directory):
            reset_active_skill_directory()
        self._registry = self._base_registry
        self._turn_unfiltered_registry = self._base_registry
        self._last_tool_batch_signature = None
        self._identical_tool_batch_count = 0
        self._pending_mid_turn_update = None
        self._processed_skill_activation_tool_ids = set()
        self._current_turn_start_index = len(self._state.messages)

        # Append user message to existing state (preserves conversation history)
        self._task_complete_summary = None

        # Auto-match skill for this turn via shared selector
        cache_prompt = getattr(get_settings(), "PROMPT_CACHE_ENABLED", False)
        prompt_assembly = PromptAssembly.from_system(self._system_prompt)
        if runtime_prompt_sections:
            dynamic_sections = tuple(
                section for section in runtime_prompt_sections if section
            )
            if dynamic_sections:
                prompt_assembly = prompt_assembly.with_volatile_sections(
                    *dynamic_sections,
                )
        self._turn_prompt_assembly = prompt_assembly
        self._auto_injected_skill = None
        settings = get_settings()
        matched = await select_skill_for_message(
            user_message=user_message,
            selected_skills=selected_skills,
            attachment_descriptors=tuple(
                AttachmentDescriptor(
                    filename=str(getattr(attachment, "filename", "") or ""),
                    content_type=str(getattr(attachment, "content_type", "") or ""),
                )
                for attachment in attachments
            ),
            skill_registry=self._skill_registry,
            client=self._client,
            model=settings.SKILL_SELECTOR_MODEL or settings.LITE_MODEL,
        )
        if matched is not None:
            self._auto_injected_skill = matched.metadata.name
            explicit_skill_name = next((s for s in selected_skills if s.strip()), None)
            source = "explicit" if explicit_skill_name is not None else "auto"
            # Replace ActivateSkill tool with active skill name (copy-on-write)
            from agent.tools.local.activate_skill import ActivateSkill

            self._registry = self._registry.replace_tool(
                ActivateSkill(
                    skill_registry=self._skill_registry,
                    active_skill_name=matched.metadata.name,
                )
            )
            self._turn_unfiltered_registry = self._registry
            try:
                await prepare_skill_for_turn(
                    executor=self._executor,
                    skill=matched,
                    emitter=self._emitter,
                    source=source,
                    install_dependencies=lambda: install_skill_dependencies_for_turn(
                        self._executor,
                        matched.metadata.dependencies,
                        self._emitter,
                        context="orchestrator",
                        skill_name=matched.metadata.name,
                        source=source,
                        raise_on_error=True,
                    ),
                )
            except Exception as exc:
                error = str(exc)
                await self._emit_task_error(
                    error,
                    code="skill_setup",
                    retryable=False,
                )
                return f"Error: {error}"
            prompt_assembly = prompt_assembly.with_volatile_sections(
                build_skill_prompt_content(matched),
            )
        else:
            self._turn_unfiltered_registry = self._registry

        uploaded_paths: tuple[str, ...] = ()
        if attachments:
            try:
                uploaded_paths = await upload_attachments_to_sandbox(
                    self._executor,
                    attachments,
                )
            except Exception as exc:
                error = f"Failed to upload attached files to the sandbox: {exc}"
                await self._emit_task_error(
                    error,
                    code="attachment_upload",
                    retryable=False,
                )
                return f"Error: {error}"

        # Build message content only after uploads are verified.
        content = build_user_message_content(
            user_message,
            attachments,
            uploaded_paths=uploaded_paths,
        )

        self._state = self._state.add_message(
            {"role": "user", "content": content},
        )
        self._state = replace(self._state, completed=False, error=None, iteration=0)
        self._turn_artifact_ids = []

        # Filter tools to skill's allowed set (if specified).
        # Entries containing ":" are treated as registry tags (e.g.
        # "mcp_server:my-server"); all others are plain tool names.
        effective_registry = self._registry
        if (
            self._auto_injected_skill is not None
            and matched is not None
            and matched.metadata.allowed_tools
        ):
            allowed_names, allowed_tags = split_allowed_tools(
                matched.metadata.allowed_tools
            )
            set_allowed_tools = getattr(self._executor, "set_allowed_tools", None)
            if callable(set_allowed_tools):
                set_allowed_tools(allowed_names, allowed_tags)
            effective_registry = self._registry.filter_by_names_or_tags(
                allowed_names, allowed_tags
            )

        tools = effective_registry.to_anthropic_tools(cache_breakpoint=cache_prompt)

        while not self._state.completed and self._state.error is None:
            if self._cancel_event.is_set():
                break
            self._state = self._state.increment_iteration()
            self._state = await self._run_iteration(
                self._state,
                tools,
                prompt_assembly.system_with_cache_control(cache_prompt),
                prompt_assembly.rendered,
            )

            if self._pending_mid_turn_update is not None:
                prompt_assembly, effective_registry, tools = (
                    self._pending_mid_turn_update
                )
                self._pending_mid_turn_update = None

            # Check if activate_skill was invoked mid-turn and enforce constraints
            updated = await self._check_mid_turn_skill_activation()
            if updated is not None:
                prompt_assembly, effective_registry, tools = updated

        logger.info("turn_complete iterations={}", self._state.iteration)

        if self._cancel_event.is_set():
            self._cancel_event.clear()
            current_turn_messages = self._state.messages[
                self._current_turn_start_index :
            ]
            final_text = extract_final_text_from_messages(current_turn_messages)
            await self._emitter.emit(
                EventType.TURN_CANCELLED,
                {"result": final_text},
            )
            # Reset so the orchestrator can accept new turns
            self._state = replace(
                self._state,
                messages=self._state.messages[: self._current_turn_start_index],
                completed=False,
                error=None,
            )
            return final_text

        if self._state.error:
            err_msg = self._state.error
            retryable = "LLM call failed" in err_msg
            code = "llm_error" if retryable else "agent_error"
            if is_content_policy_error(err_msg):
                code = "content_policy"
                retryable = False
            if "maximum iterations" in err_msg.lower():
                code = "max_iterations"
                retryable = False
            await self._emit_task_error(err_msg, code=code, retryable=retryable)
            return f"Error: {self._state.error}"

        final_text = extract_final_text(self._state)
        await self._emitter.emit(
            EventType.TURN_COMPLETE,
            {"result": final_text, "artifact_ids": self._turn_artifact_ids},
        )
        return final_text

    async def _check_mid_turn_skill_activation(
        self,
    ) -> tuple[PromptAssembly, ToolRegistry, list[dict[str, Any]]] | None:
        """Detect a successful mid-turn activate_skill call and enforce constraints.

        Returns (effective_prompt, effective_registry, tools) if a new skill was
        activated, or None if no change occurred.
        """
        if self._skill_registry is None:
            return None

        # Look at the last assistant message for activate_skill tool_use blocks
        last_assistant = None
        for msg in reversed(self._state.messages):
            if msg.get("role") == "assistant":
                last_assistant = msg
                break

        if last_assistant is None:
            return None

        content = last_assistant.get("content")
        if not isinstance(content, list):
            return None

        # Find activate_skill tool_use block (single pass)
        activated_name: str | None = None
        tool_id: str | None = None
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            block_name = block.get("name")
            if block_name == "activate_skill":
                skill_input = block.get("input", {})
                activated_name = skill_input.get("name")
                tool_id = block.get("id")
                break
            if (
                isinstance(block_name, str)
                and self._skill_registry.find_by_name(block_name) is not None
            ):
                activated_name = block_name
                tool_id = block.get("id")
                break

        if not activated_name:
            return None

        if tool_id is not None and tool_use_had_error_result(
            list(self._state.messages),
            tool_id,
        ):
            return None

        if activated_name == self._auto_injected_skill:
            await emit_redundant_skill_activation(
                self._emitter,
                skill_name=activated_name,
                tool_id=tool_id,
                messages=list(self._state.messages),
            )
            return None

        return await self._apply_mid_turn_skill_activation(
            activated_name,
            tool_id=tool_id,
        )

    async def _run_iteration(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        system_prompt: SystemPrompt | None = None,
        system_prompt_text: str | None = None,
    ) -> AgentState:
        """Run a single iteration of the ReAct loop."""
        effective_system = system_prompt or self._system_prompt
        effective_prompt = system_prompt_text or render_system_prompt(effective_system)

        settings = get_settings()
        if settings.VALIDATE_AGENT_MESSAGE_CHAIN:
            chain_warnings = collect_message_chain_warnings(state.messages)
            for w in chain_warnings:
                logger.warning("message_chain_warning detail={}", w)

        # Compact message history before the LLM call if needed
        if self._observer.should_compact(state.messages, effective_prompt):
            logger.debug("compacting_message_history")
            if (
                self._compaction_profile.memory_flush
                and self._persistent_store is not None
            ):
                await flush_heuristic_facts_from_messages(
                    self._persistent_store,
                    state.messages,
                )
            compacted = await self._observer.compact(state.messages, effective_prompt)
            await self._emitter.emit(
                EventType.CONTEXT_COMPACTED,
                {
                    "original_messages": len(state.messages),
                    "compacted_messages": len(compacted),
                    "summary_text": compaction_summary_for_persistence(compacted),
                    "summary_scope": "conversation",
                    "compaction_profile": self._compaction_profile.name,
                },
                iteration=state.iteration,
            )
            state = replace(state, messages=compacted)

        logger.info("iteration={}/{}", state.iteration, self._max_iterations)

        await self._emitter.emit(
            EventType.ITERATION_START,
            {"iteration": state.iteration},
            iteration=state.iteration,
        )

        if state.iteration > self._max_iterations:
            logger.warning("max_iterations_exceeded limit={}", self._max_iterations)
            return state.mark_error(
                f"Exceeded maximum iterations ({self._max_iterations})",
            )

        llm_model = getattr(self._client, "default_model", "<unknown>")
        message_chars = sum(
            len(json.dumps(message, ensure_ascii=True)) for message in state.messages
        )
        # region agent log
        _emit_debug_log(
            run_id="initial",
            hypothesis_id="H3",
            location="backend/agent/runtime/orchestrator.py:_run_iteration:pre_call",
            message="Orchestrator pre-LLM payload stats",
            data={
                "model": llm_model,
                "iteration": state.iteration,
                "messageCount": len(state.messages),
                "messageChars": message_chars,
                "toolCount": len(tools),
                "systemPromptChars": len(effective_prompt),
            },
        )
        # endregion
        try:
            thinking_emitted_during_stream = False

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta},
                    iteration=state.iteration,
                )

            async def _on_thinking_ready(thinking: str) -> None:
                nonlocal thinking_emitted_during_stream
                if not thinking:
                    return
                thinking_emitted_during_stream = True
                await self._emitter.emit(
                    EventType.THINKING,
                    {"thinking": thinking},
                    iteration=state.iteration,
                )

            stream_kwargs = dict(
                system=effective_system,
                messages=list(state.messages),
                tools=tools if tools else None,
                on_text_delta=_on_text_delta,
                thinking_budget=self._thinking_budget,
            )
            try:
                response = await self._client.create_message_stream(
                    **stream_kwargs,
                    on_thinking_ready=_on_thinking_ready,
                )
            except TypeError as exc:
                if "on_thinking_ready" not in str(exc):
                    raise
                response = await self._client.create_message_stream(**stream_kwargs)
        except Exception as exc:
            # region agent log
            _emit_debug_log(
                run_id="initial",
                hypothesis_id="H5",
                location="backend/agent/runtime/orchestrator.py:_run_iteration:exception",
                message="Orchestrator captured LLM exception",
                data={
                    "model": llm_model,
                    "iteration": state.iteration,
                    "errorType": type(exc).__name__,
                    "errorText": str(exc)[:500],
                },
            )
            # endregion
            logger.error("llm_call_failed model={} error={}", llm_model, exc)
            return state.mark_error(format_llm_failure(exc))

        logger.info(
            "llm_response model={} stop_reason={} tool_calls={} input_tokens={} output_tokens={}",
            llm_model,
            response.stop_reason,
            len(response.tool_calls),
            response.usage.input_tokens,
            response.usage.output_tokens,
        )

        if response.thinking and not thinking_emitted_during_stream:
            await self._emitter.emit(
                EventType.THINKING,
                {"thinking": response.thinking},
                iteration=state.iteration,
            )

        await self._emitter.emit(
            EventType.LLM_RESPONSE,
            {
                "text": response.text,
                "tool_call_count": len(response.tool_calls),
                "stop_reason": response.stop_reason,
                "usage": response.usage,
            },
            iteration=state.iteration,
        )

        state = apply_response_to_state(state, response)

        if not response.tool_calls:
            return state.mark_completed()

        async def _post_tool_callback(tc: Any, result: Any) -> None:
            skill_name = self._requested_skill_name_from_tool_call(tc.name, tc.input)
            if skill_name is None or not result.success:
                return
            updated = await self._apply_mid_turn_skill_activation(
                skill_name,
                tool_id=tc.id,
            )
            if updated is not None:
                self._pending_mid_turn_update = updated

        try:
            tool_result = await process_tool_calls(
                state=state,
                tool_calls=response.tool_calls,
                executor=self._executor,
                emitter=self._emitter,
                stop_check=lambda: self._task_complete_summary is not None,
                cancel_check=lambda: self._cancel_event.is_set(),
                post_tool_callback=_post_tool_callback,
            )
        except Exception as exc:
            return state.mark_error(str(exc))
        state = tool_result.state
        self._turn_artifact_ids.extend(tool_result.artifact_ids)

        threshold = settings.STUCK_LOOP_TOOL_REPEAT_THRESHOLD
        if threshold > 0 and response.tool_calls:
            sig = tool_calls_fingerprint(response.tool_calls)
            if sig == self._last_tool_batch_signature:
                self._identical_tool_batch_count += 1
            else:
                self._last_tool_batch_signature = sig
                self._identical_tool_batch_count = 1
            if self._identical_tool_batch_count >= threshold:
                nudge = (
                    "System notice: The same tool calls were repeated several times. "
                    "Change approach: verify assumptions, try different tools, "
                    "or explain what is blocking progress."
                )
                await self._emitter.emit(
                    EventType.LOOP_GUARD_NUDGE,
                    {
                        "iteration": state.iteration,
                        "repeated_signature": sig[:500],
                    },
                    iteration=state.iteration,
                )
                state = self._append_text_guard_to_last_user_message(state, nudge)
                self._identical_tool_batch_count = 0
                self._last_tool_batch_signature = None

        # Check if task_complete tool was invoked during tool processing
        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        return state
