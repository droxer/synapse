"""Task agent runner for executing focused sub-tasks."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, replace
from typing import Any, Literal

from agent.context.profiles import CompactionProfile, resolve_compaction_profile
from agent.llm.client import (
    AnthropicClient,
    SystemPrompt,
    format_llm_failure,
    render_system_prompt,
)
from agent.runtime.helpers import (
    apply_response_to_state,
    extract_final_text,
    process_tool_calls,
)
from agent.context.compaction import Observer, compaction_summary_for_persistence
from agent.runtime.orchestrator import AgentState
from agent.runtime.system_prompt_sections import (
    build_memory_aware_system_prompt_sections,
)
from agent.runtime.skill_install import install_skill_dependencies_for_turn
from agent.runtime.skill_runtime import split_allowed_tools
from agent.runtime.skill_setup import (
    build_skill_prompt_content,
    emit_redundant_skill_activation,
    prepare_skill_for_turn,
    tool_use_had_error_result,
)
from agent.runtime.prompting import PromptAssembly
from agent.runtime.skill_selector import select_skill_for_message
from agent.skills.loader import SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.registry import ToolRegistry
from api.events import EventEmitter, EventType
from config.settings import Settings, get_settings
from loguru import logger


FailureMode = Literal["cancel_downstream", "degrade", "replan"]
DependencyFailureMode = Literal["inherit", "cancel_downstream", "degrade", "replan"]


@dataclass(frozen=True)
class TaskAgentConfig:
    """Immutable configuration for a task agent."""

    task_description: str
    name: str = ""
    context: str = ""
    sandbox_template: str = "default"
    priority: int = 0
    depends_on: tuple[str, ...] = ()
    model: str | None = None
    timeout_seconds: float | None = None
    role: str = ""
    max_handoffs: int = 3
    dependency_failure_mode: DependencyFailureMode = "inherit"
    allow_redundant: bool = False


@dataclass(frozen=True)
class HandoffRequest:
    """Immutable request to hand off to a new agent."""

    target_role: str
    task_description: str
    context: str
    source_messages: tuple[dict, ...]
    remaining_handoffs: int


@dataclass(frozen=True)
class AgentRunMetrics:
    """Immutable metrics captured for a task agent run."""

    duration_seconds: float
    iterations: int
    tool_call_count: int
    context_compaction_count: int
    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class AgentResult:
    """Immutable result of a task agent execution."""

    agent_id: str
    success: bool
    summary: str
    artifacts: tuple[str, ...] = ()
    error: str | None = None
    handoff: HandoffRequest | None = None
    failure_mode: FailureMode = "cancel_downstream"
    metrics: AgentRunMetrics | None = None
    skip_execution: bool = False
    replan_required: bool = False
    completed_via_task_complete: bool = False


@dataclass(frozen=True)
class TaskAgentPromptTemplate:
    """Reusable immutable prompt template for task agents."""

    header: str
    guidelines: str

    def render(self, config: TaskAgentConfig) -> str:
        """Render the full system prompt for a specific task-agent config."""
        role_section = f"\nYour role: {config.role}\n" if config.role else ""
        context_section = (
            f"\nAdditional context:\n{config.context}" if config.context else ""
        )
        return (
            f"{self.header}\n"
            f"{role_section}"
            f"Your task: {config.task_description}\n"
            f"{context_section}\n\n"
            f"{self.guidelines}"
        )


TASK_AGENT_PROMPT_TEMPLATE = TaskAgentPromptTemplate(
    header="You are a task agent focused on completing a specific objective.",
    guidelines="""Guidelines:
- Focus exclusively on the assigned task
- Use available tools to accomplish the objective
- Use agent_send and agent_receive to coordinate with other agents if needed
- Be thorough but efficient
- When done, call task_complete with a detailed summary of what was accomplished
- Include any relevant file paths or outputs in your summary""",
)


def ensure_task_agent_name_suffix(name: str) -> str:
    """Ensure user-facing task-agent names end with the ``agent`` suffix."""
    trimmed = name.strip()
    if not trimmed:
        return ""
    if trimmed.lower().endswith(" agent"):
        return trimmed
    return f"{trimmed} agent"


def _build_system_prompt(
    config: TaskAgentConfig,
    *,
    prompt_template: TaskAgentPromptTemplate = TASK_AGENT_PROMPT_TEMPLATE,
    memory_entries: list[dict[str, str]] | None = None,
    skill_registry: SkillRegistry | None = None,
    settings: Any | None = None,
) -> str:
    """Build the system prompt from a TaskAgentConfig."""
    return render_system_prompt(
        build_memory_aware_system_prompt_sections(
            prompt_template.render(config),
            memory_entries,
            skill_registry,
            settings=settings,
        )
    )


class TaskAgentRunner:
    """Runs a focused sub-task using a ReAct loop."""

    def __init__(
        self,
        agent_id: str,
        config: TaskAgentConfig,
        claude_client: AnthropicClient,
        tool_registry: ToolRegistry,
        tool_executor: ToolExecutor,
        event_emitter: EventEmitter,
        max_iterations: int = 50,
        observer: Observer | None = None,
        compaction_profile: CompactionProfile | None = None,
        skill_registry: SkillRegistry | None = None,
        prompt_template: TaskAgentPromptTemplate = TASK_AGENT_PROMPT_TEMPLATE,
        memory_entries: list[dict[str, str]] | None = None,
        shared_tools: list[dict[str, Any]] | None = None,
        shared_tools_fingerprint: str | None = None,
    ) -> None:
        if not agent_id:
            raise ValueError("agent_id must not be empty")
        if not config.task_description.strip():
            raise ValueError("task_description must not be empty")
        settings = get_settings()

        self._agent_id = agent_id
        self._config = config
        self._client = claude_client
        self._registry = tool_registry
        self._executor = tool_executor
        self._emitter = event_emitter
        self._max_iterations = max_iterations
        self._skill_registry = skill_registry
        resolved_profile = compaction_profile or resolve_compaction_profile(
            settings, "task_agent"
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
        self._prompt_template = prompt_template
        self._system_prompt = _build_system_prompt(
            config,
            prompt_template=prompt_template,
            memory_entries=memory_entries,
            skill_registry=(
                skill_registry if getattr(settings, "SKILLS_ENABLED", True) else None
            ),
            settings=settings,
        )
        self._turn_prompt_assembly = PromptAssembly.from_system(self._system_prompt)
        self._auto_injected_skill: str | None = None
        self._task_complete_summary: str | None = None
        self._handoff_request: HandoffRequest | None = None
        self._artifact_ids: list[str] = []
        self._iterations = 0
        self._tool_call_count = 0
        self._context_compaction_count = 0
        self._input_tokens = 0
        self._output_tokens = 0
        self._shared_tools = shared_tools
        self._shared_tools_fingerprint = shared_tools_fingerprint
        self._turn_unfiltered_registry = tool_registry
        self._pending_mid_turn_update: (
            tuple[PromptAssembly, ToolRegistry, list[dict[str, Any]]] | None
        ) = None
        self._processed_skill_activation_tool_ids: set[str] = set()
        self._completed_via_task_complete = False

    async def on_task_complete(self, summary: str) -> None:
        """Callback for the task_complete tool."""
        self._task_complete_summary = summary
        self._completed_via_task_complete = True

    async def on_handoff(self, request: HandoffRequest) -> None:
        """Callback for the agent_handoff tool."""
        self._handoff_request = request

    async def run(self) -> AgentResult:
        """Execute the task agent loop and return an AgentResult."""
        self._reset_run_state()
        reset_sandbox_template = getattr(self._executor, "reset_sandbox_template", None)
        if callable(reset_sandbox_template):
            reset_sandbox_template()
        configured_template = self._config.sandbox_template.strip()
        if configured_template:
            set_sandbox_template = getattr(self._executor, "set_sandbox_template", None)
            if callable(set_sandbox_template):
                set_sandbox_template(configured_template)
        reset_active_skill_directory = getattr(
            self._executor, "reset_active_skill_directory", None
        )
        if callable(reset_active_skill_directory):
            reset_active_skill_directory()
        reset_allowed_tools = getattr(self._executor, "reset_allowed_tools", None)
        if callable(reset_allowed_tools):
            reset_allowed_tools()
        started_at = time.perf_counter()
        settings = get_settings()
        timeout_seconds = (
            self._config.timeout_seconds
            if self._config.timeout_seconds is not None
            else settings.AGENT_TIMEOUT_SECONDS
        )

        try:
            final_text = await asyncio.wait_for(
                self._execute_loop(),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            error = f"Task agent timed out after {timeout_seconds}s"
            metrics = self._build_metrics(started_at)
            return AgentResult(
                agent_id=self._agent_id,
                success=False,
                summary="",
                artifacts=tuple(self._artifact_ids),
                error=error,
                failure_mode="cancel_downstream",
                metrics=metrics,
            )
        except Exception as exc:
            logger.exception("Task agent {} failed: {}", self._agent_id, exc)
            metrics = self._build_metrics(started_at)
            return AgentResult(
                agent_id=self._agent_id,
                success=False,
                summary="",
                artifacts=tuple(self._artifact_ids),
                error=str(exc),
                metrics=metrics,
            )

        metrics = self._build_metrics(started_at)
        return AgentResult(
            agent_id=self._agent_id,
            success=True,
            summary=final_text,
            artifacts=tuple(self._artifact_ids),
            handoff=self._handoff_request,
            metrics=metrics,
            completed_via_task_complete=self._completed_via_task_complete,
        )

    def _reset_run_state(self) -> None:
        """Reset per-run counters before starting execution."""
        self._artifact_ids = []
        self._iterations = 0
        self._tool_call_count = 0
        self._context_compaction_count = 0
        self._input_tokens = 0
        self._output_tokens = 0
        self._task_complete_summary = None
        self._handoff_request = None
        self._pending_mid_turn_update = None
        self._processed_skill_activation_tool_ids = set()
        self._completed_via_task_complete = False

    def _build_metrics(self, started_at: float) -> AgentRunMetrics:
        """Build a metrics snapshot for the current run."""
        return AgentRunMetrics(
            duration_seconds=time.perf_counter() - started_at,
            iterations=self._iterations,
            tool_call_count=self._tool_call_count,
            context_compaction_count=self._context_compaction_count,
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
        )

    def _requested_skill_name_from_tool_call(
        self,
        tool_call_name: str,
        tool_input: dict[str, Any],
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
        messages: list[dict[str, Any]],
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
                messages=messages,
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
                context="task_runner_mid_turn",
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

        if tool_id is not None:
            self._processed_skill_activation_tool_ids.add(tool_id)
        logger.info("task_runner_mid_turn_skill_activated name={}", skill.metadata.name)
        return (
            prompt_assembly,
            updated_registry,
            updated_registry.to_anthropic_tools(
                cache_breakpoint=getattr(get_settings(), "PROMPT_CACHE_ENABLED", False)
            ),
        )

    async def _execute_loop(self) -> str:
        """Run the ReAct loop until completion or error."""
        settings = get_settings()
        state = AgentState().add_message(
            {"role": "user", "content": self._config.task_description},
        )
        cache_prompt = getattr(get_settings(), "PROMPT_CACHE_ENABLED", False)
        prompt_assembly = PromptAssembly.from_system(self._system_prompt)
        effective_registry = self._registry
        self._turn_unfiltered_registry = effective_registry
        self._auto_injected_skill = None

        matched = await select_skill_for_message(
            user_message=self._config.task_description,
            selected_skills=(),
            skill_registry=self._skill_registry,
            client=self._client,
            model=settings.SKILL_SELECTOR_MODEL or settings.LITE_MODEL,
        )
        if matched is not None:
            self._auto_injected_skill = matched.metadata.name
            self._turn_prompt_assembly = prompt_assembly

            from agent.tools.local.activate_skill import ActivateSkill

            effective_registry = effective_registry.replace_tool(
                ActivateSkill(
                    skill_registry=self._skill_registry,
                    active_skill_name=matched.metadata.name,
                )
            )
            self._turn_unfiltered_registry = effective_registry
            await prepare_skill_for_turn(
                executor=self._executor,
                skill=matched,
                emitter=self._emitter,
                source="auto",
                install_dependencies=lambda: install_skill_dependencies_for_turn(
                    self._executor,
                    matched.metadata.dependencies,
                    self._emitter,
                    context="task_runner",
                    skill_name=matched.metadata.name,
                    source="auto",
                    raise_on_error=True,
                ),
            )
            prompt_assembly = prompt_assembly.with_volatile_sections(
                build_skill_prompt_content(matched),
            )

            if matched.metadata.allowed_tools:
                allowed_names, allowed_tags = split_allowed_tools(
                    matched.metadata.allowed_tools
                )
                set_allowed_tools = getattr(self._executor, "set_allowed_tools", None)
                if callable(set_allowed_tools):
                    set_allowed_tools(allowed_names, allowed_tags)
                effective_registry = effective_registry.filter_by_names_or_tags(
                    allowed_names, allowed_tags
                )
        else:
            self._turn_unfiltered_registry = effective_registry

        registry_fingerprint = effective_registry.anthropic_tools_fingerprint()
        if (
            self._shared_tools is not None
            and self._shared_tools_fingerprint == registry_fingerprint
        ):
            tools = self._shared_tools
        else:
            tools = effective_registry.to_anthropic_tools(cache_breakpoint=cache_prompt)

        while not state.completed and state.error is None:
            state = state.increment_iteration()
            self._iterations = state.iteration
            state = await self._run_iteration(
                state,
                tools,
                settings,
                prompt_assembly.system_with_cache_control(cache_prompt),
                prompt_assembly.rendered,
            )

            if self._pending_mid_turn_update is not None:
                prompt_assembly, effective_registry, tools = (
                    self._pending_mid_turn_update
                )
                self._pending_mid_turn_update = None

            updated = await self._check_mid_turn_skill_activation(state)
            if updated is not None:
                prompt_assembly, effective_registry, tools = updated

        if state.error:
            raise RuntimeError(state.error)

        return extract_final_text(state)

    async def _run_iteration(
        self,
        state: AgentState,
        tools: list[dict[str, Any]],
        settings: Settings,
        system_prompt: SystemPrompt,
        system_prompt_text: str,
    ) -> AgentState:
        """Run a single iteration of the task agent loop."""
        # Compact history before the LLM call if needed
        if self._observer.should_compact(state.messages, system_prompt_text):
            compacted = await self._observer.compact(
                state.messages,
                system_prompt_text,
            )
            self._context_compaction_count += 1
            await self._emitter.emit(
                EventType.CONTEXT_COMPACTED,
                {
                    "original_messages": len(state.messages),
                    "compacted_messages": len(compacted),
                    "summary_text": compaction_summary_for_persistence(compacted),
                    "summary_scope": "task_agent",
                    "agent_id": self._agent_id,
                    "compaction_profile": self._compaction_profile.name,
                },
            )
            state = replace(state, messages=compacted)

        if state.iteration > self._max_iterations:
            return state.mark_error(
                f"Exceeded maximum iterations ({self._max_iterations})",
            )

        llm_model = self._config.model or settings.TASK_MODEL
        debug_logging_enabled = getattr(settings, "AGENT_DEBUG_LOGGING", False)
        try:
            if debug_logging_enabled:
                logger.debug(
                    "task_runner_llm_call agent_id={} model={} iteration={} messages={} tools={}",
                    self._agent_id,
                    llm_model,
                    state.iteration,
                    len(state.messages),
                    len(tools),
                )

            async def _on_text_delta(delta: str) -> None:
                await self._emitter.emit(
                    EventType.TEXT_DELTA,
                    {"delta": delta, "agent_id": self._agent_id},
                    iteration=state.iteration,
                )

            response = await self._client.create_message_stream(
                system=system_prompt,
                messages=list(state.messages),
                tools=tools if tools else None,
                model=llm_model,
                on_text_delta=_on_text_delta,
            )
        except Exception as exc:
            if debug_logging_enabled:
                logger.debug(
                    "task_runner_llm_exception agent_id={} model={} iteration={} error_type={}",
                    self._agent_id,
                    llm_model,
                    state.iteration,
                    type(exc).__name__,
                )
            logger.error("llm_call_failed model={} error={}", llm_model, exc)
            return state.mark_error(format_llm_failure(exc))

        state = apply_response_to_state(state, response)
        self._input_tokens += response.usage.input_tokens
        self._output_tokens += response.usage.output_tokens

        if not response.tool_calls:
            return state.mark_completed()

        async def _post_tool_callback(tc: Any, result: Any) -> None:
            skill_name = self._requested_skill_name_from_tool_call(tc.name, tc.input)
            if skill_name is None or not result.success:
                return
            updated = await self._apply_mid_turn_skill_activation(
                skill_name,
                tool_id=tc.id,
                messages=list(state.messages),
            )
            if updated is not None:
                self._pending_mid_turn_update = updated

        try:
            tool_result = await process_tool_calls(
                state=state,
                tool_calls=response.tool_calls,
                executor=self._executor,
                emitter=self._emitter,
                agent_id=self._agent_id,
                stop_check=lambda: (
                    self._task_complete_summary is not None
                    or self._handoff_request is not None
                ),
                post_tool_callback=_post_tool_callback,
            )
        except Exception as exc:
            return state.mark_error(str(exc))
        state = tool_result.state
        self._tool_call_count += tool_result.processed_count
        for artifact_id in tool_result.artifact_ids:
            if artifact_id not in self._artifact_ids:
                self._artifact_ids.append(artifact_id)

        if self._task_complete_summary is not None:
            return state.mark_completed(self._task_complete_summary)

        if self._handoff_request is not None:
            handoff_with_messages = HandoffRequest(
                target_role=self._handoff_request.target_role,
                task_description=self._handoff_request.task_description,
                context=self._handoff_request.context,
                source_messages=state.messages,
                remaining_handoffs=self._handoff_request.remaining_handoffs,
            )
            self._handoff_request = handoff_with_messages
            return state.mark_completed("Handing off to specialist agent.")

        return state

    async def _check_mid_turn_skill_activation(
        self,
        state: AgentState,
    ) -> tuple[PromptAssembly, ToolRegistry, list[dict[str, Any]]] | None:
        """Detect successful mid-turn skill activation and apply constraints."""
        if self._skill_registry is None:
            return None

        last_assistant = None
        for msg in reversed(state.messages):
            if msg.get("role") == "assistant":
                last_assistant = msg
                break

        if last_assistant is None:
            return None

        content = last_assistant.get("content")
        if not isinstance(content, list):
            return None

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
            list(state.messages),
            tool_id,
        ):
            return None

        return await self._apply_mid_turn_skill_activation(
            activated_name,
            tool_id=tool_id,
            messages=list(state.messages),
        )
