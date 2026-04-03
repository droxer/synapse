"""Builder helpers for constructing orchestrators, registries, and sandbox providers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.artifacts.storage import StorageBackend
from agent.llm.client import AnthropicClient
from agent.llm.image import MiniMaxImageClient
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PlannerOrchestrator
from agent.runtime.sub_agent_manager import SubAgentManager
from agent.memory.store import PersistentMemoryStore
from agent.sandbox.base import SandboxProvider
from agent.skills.loader import SkillRegistry as SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.local.ask_user import AskUser
from agent.tools.local.image_gen import ImageGen
from agent.tools.local.memory_list import MemoryList
from agent.tools.local.memory_recall import MemoryRecall
from agent.tools.local.memory_store import MemoryStore
from agent.tools.local.message_user import MessageUser
from agent.tools.local.task_complete import TaskComplete
from agent.tools.local.web_fetch import WebFetch
from agent.tools.local.web_search import TavilyWebSearch
from agent.tools.registry import ToolRegistry
from agent.tools.sandbox.browser import BrowserUse
from agent.tools.sandbox.browser_tools import (
    BrowserClick,
    BrowserConsoleExec,
    BrowserConsoleView,
    BrowserInput,
    BrowserNavigate,
    BrowserPressKey,
    BrowserScrollDown,
    BrowserScrollUp,
    BrowserSelect,
    BrowserView,
)
from agent.tools.sandbox.code_interpret import CodeInterpret
from agent.tools.sandbox.code_run import CodeRun
from agent.tools.sandbox.code_search import FileGlob, FileSearch
from agent.tools.sandbox.computer_use import ComputerAction, ComputerScreenshot
from agent.tools.sandbox.database import DbCreate, DbQuery, DbSchema
from agent.tools.sandbox.doc_read import DocRead
from agent.tools.sandbox.file_ops import FileEdit, FileList, FileRead, FileWrite
from agent.tools.sandbox.package_install import PackageInstall
from agent.tools.sandbox.preview import PreviewStart, PreviewStop
from agent.tools.sandbox.shell_exec import ShellExec
from agent.tools.sandbox.shell_tools import ShellKill, ShellView, ShellWait, ShellWrite
from api.events import EventEmitter
from api.models import MCPState
from config.settings import get_settings


# ---------------------------------------------------------------------------
# Callback holder -- avoids two-phase orchestrator construction (H3 fix)
# ---------------------------------------------------------------------------


class _CallbackHolder:
    """Mutable holder for a completion callback."""

    def __init__(self) -> None:
        self._callback: Callable[..., Any] | None = None

    async def __call__(self, summary: str) -> None:
        if self._callback is not None:
            await self._callback(summary)

    def set(self, callback: Callable[..., Any]) -> None:
        self._callback = callback


# ---------------------------------------------------------------------------
# Sandbox provider
# ---------------------------------------------------------------------------


def _build_sandbox_provider() -> tuple[SandboxProvider, Any]:
    """Create a sandbox provider based on SANDBOX_PROVIDER setting.

    Returns the provider and an optional pool (for shutdown draining).
    """
    settings = get_settings()
    provider = settings.SANDBOX_PROVIDER

    if provider == "boxlite":
        from agent.sandbox.boxlite_provider import BoxliteProvider

        logger.info("Using BoxliteProvider (micro-VM sandbox)")
        return BoxliteProvider(), None

    if provider == "e2b":
        from agent.sandbox.e2b_pool import SandboxPool
        from agent.sandbox.e2b_provider import E2BProvider

        api_key = settings.E2B_API_KEY
        if not api_key:
            raise RuntimeError("SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set")
        pool = SandboxPool(api_key=api_key)
        logger.info("Using E2BProvider (cloud sandbox) with pooling")
        return E2BProvider(api_key=api_key, pool=pool), pool

    raise ValueError(
        f"Unknown SANDBOX_PROVIDER={provider!r}. Must be 'boxlite' or 'e2b'."
    )


# ---------------------------------------------------------------------------
# Tool registries
# ---------------------------------------------------------------------------


def _build_base_registry(
    event_emitter: EventEmitter,
    on_complete: Any,
    sandbox_provider: SandboxProvider,
    storage_backend: StorageBackend | None,
    mcp_state: MCPState,
    artifact_manager: ArtifactManager | None = None,
    persistent_store: PersistentMemoryStore | None = None,
    skill_registry: SkillRegistry | None = None,
) -> ToolRegistry:
    """Build the shared tool registry with all standard tools registered."""
    settings = get_settings()
    memory: dict[str, str] = {}

    registry = ToolRegistry()
    # Local tools
    registry = registry.register(TavilyWebSearch(api_key=settings.TAVILY_API_KEY))
    registry = registry.register(WebFetch())
    registry = registry.register(MessageUser(event_emitter=event_emitter))
    registry = registry.register(AskUser(event_emitter=event_emitter))
    registry = registry.register(TaskComplete(on_complete=on_complete))
    registry = registry.register(
        MemoryStore(store=memory, persistent_store=persistent_store)
    )
    registry = registry.register(
        MemoryRecall(store=memory, persistent_store=persistent_store)
    )
    registry = registry.register(
        MemoryList(store=memory, persistent_store=persistent_store)
    )

    # Conditionally register image_gen when API key is configured
    if settings.MINIMAX_API_KEY and artifact_manager is not None:
        image_client = MiniMaxImageClient(
            api_key=settings.MINIMAX_API_KEY,
            api_host=settings.MINIMAX_API_HOST,
        )
        registry = registry.register(
            ImageGen(
                client=image_client,
                artifact_manager=artifact_manager,
                event_emitter=event_emitter,
            )
        )

    # Sandbox tools
    registry = registry.register(CodeRun())
    registry = registry.register(ShellExec())
    registry = registry.register(ShellView())
    registry = registry.register(ShellWait())
    registry = registry.register(ShellWrite())
    registry = registry.register(ShellKill())
    registry = registry.register(CodeInterpret())
    registry = registry.register(FileRead())
    registry = registry.register(FileWrite())
    registry = registry.register(FileEdit())
    registry = registry.register(FileList())
    registry = registry.register(PackageInstall())
    registry = registry.register(FileGlob())
    registry = registry.register(FileSearch())
    registry = registry.register(DocRead())
    # Browser tools — high-level autonomous agent
    registry = registry.register(
        BrowserUse(
            anthropic_api_key=settings.ANTHROPIC_API_KEY,
            model=settings.TASK_MODEL,
            anthropic_base_url=settings.ANTHROPIC_BASE_URL,
        )
    )
    # Browser tools — granular DOM-indexed primitives
    registry = registry.register(BrowserNavigate())
    registry = registry.register(BrowserView())
    registry = registry.register(BrowserClick())
    registry = registry.register(BrowserInput())
    registry = registry.register(BrowserSelect())
    registry = registry.register(BrowserScrollUp())
    registry = registry.register(BrowserScrollDown())
    registry = registry.register(BrowserPressKey())
    registry = registry.register(BrowserConsoleExec())
    registry = registry.register(BrowserConsoleView())
    # Database tools
    registry = registry.register(DbCreate())
    registry = registry.register(DbQuery())
    registry = registry.register(DbSchema())
    # Computer Use tools
    registry = registry.register(ComputerScreenshot())
    registry = registry.register(ComputerAction())
    # Preview tools
    registry = registry.register(PreviewStart())
    registry = registry.register(PreviewStop())

    # Merge MCP tools if available
    if mcp_state.registry is not None:
        registry = registry.merge(mcp_state.registry)

    # Register activate_skill tool if skills are enabled
    if skill_registry is not None and settings.SKILLS_ENABLED:
        registry = registry.register(ActivateSkill(skill_registry=skill_registry))

    return registry


def _build_sub_agent_registry_factory(
    event_emitter: EventEmitter,
    sandbox_provider: SandboxProvider,
    mcp_state: MCPState,
) -> Callable[[], ToolRegistry]:
    """Factory that produces fully-populated registries for sub-agents (C1 fix)."""

    def factory() -> ToolRegistry:
        settings = get_settings()
        memory: dict[str, str] = {}
        registry = ToolRegistry()
        registry = registry.register(TavilyWebSearch(api_key=settings.TAVILY_API_KEY))
        registry = registry.register(WebFetch())
        registry = registry.register(MessageUser(event_emitter=event_emitter))
        registry = registry.register(MemoryStore(store=memory))
        registry = registry.register(MemoryRecall(store=memory))
        # Sandbox tools
        registry = registry.register(CodeRun())
        registry = registry.register(ShellExec())
        registry = registry.register(ShellView())
        registry = registry.register(ShellWait())
        registry = registry.register(ShellWrite())
        registry = registry.register(ShellKill())
        registry = registry.register(CodeInterpret())
        registry = registry.register(FileRead())
        registry = registry.register(FileWrite())
        registry = registry.register(FileEdit())
        registry = registry.register(FileList())
        registry = registry.register(PackageInstall())
        registry = registry.register(FileGlob())
        registry = registry.register(FileSearch())
        registry = registry.register(DocRead())
        # Browser tools — high-level autonomous agent
        registry = registry.register(
            BrowserUse(
                anthropic_api_key=settings.ANTHROPIC_API_KEY,
                model=settings.TASK_MODEL,
                anthropic_base_url=settings.ANTHROPIC_BASE_URL,
            )
        )
        # Browser tools — granular DOM-indexed primitives
        registry = registry.register(BrowserNavigate())
        registry = registry.register(BrowserView())
        registry = registry.register(BrowserClick())
        registry = registry.register(BrowserInput())
        registry = registry.register(BrowserSelect())
        registry = registry.register(BrowserScrollUp())
        registry = registry.register(BrowserScrollDown())
        registry = registry.register(BrowserPressKey())
        registry = registry.register(BrowserConsoleExec())
        registry = registry.register(BrowserConsoleView())
        # Database tools
        registry = registry.register(DbCreate())
        registry = registry.register(DbQuery())
        registry = registry.register(DbSchema())
        # Computer Use tools
        registry = registry.register(ComputerScreenshot())
        registry = registry.register(ComputerAction())
        # Preview tools
        registry = registry.register(PreviewStart())
        registry = registry.register(PreviewStop())

        # Merge MCP tools if available
        if mcp_state.registry is not None:
            registry = registry.merge(mcp_state.registry)

        return registry

    return factory


# ---------------------------------------------------------------------------
# Orchestrator builders
# ---------------------------------------------------------------------------


def _format_memory_prompt_section(
    memory_entries: list[dict[str, str]],
) -> str:
    """Format memory entries as a system prompt section."""
    if not memory_entries:
        return ""
    lines = [
        "\n<personal_memory>",
        "The following are things you have previously remembered about this user. "
        "Use this context to personalise your responses. "
        "You can update or add new memories with the memory_store tool.",
    ]
    for entry in memory_entries:
        ns = entry.get("namespace", "default")
        key = entry["key"]
        value = entry["value"]
        if ns != "default":
            lines.append(f"- [{ns}] {key}: {value}")
        else:
            lines.append(f"- {key}: {value}")
    lines.append("</personal_memory>")
    return "\n".join(lines)


def build_agent_system_prompt(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> str:
    """Assemble the same system prompt string used by the main orchestrator."""
    settings = get_settings()
    system_prompt = settings.DEFAULT_SYSTEM_PROMPT
    if skill_registry is not None and settings.SKILLS_ENABLED:
        catalog_section = skill_registry.catalog_prompt_section()
        if catalog_section:
            system_prompt = system_prompt + "\n" + catalog_section
    memory_section = _format_memory_prompt_section(memory_entries or [])
    if memory_section:
        system_prompt = system_prompt + "\n" + memory_section
    return system_prompt


def format_verified_facts_prompt_section(
    facts: list[dict[str, str]],
    token_cap_chars: int,
) -> str:
    """Format verified fact records into a bounded prompt section."""
    if not facts:
        return ""

    lines = ["<verified_user_facts>", "Known user facts (verified):"]
    for fact in facts:
        ns = fact.get("namespace", "default")
        key = fact.get("key", "")
        value = fact.get("value", "")
        if not key or not value:
            continue
        lines.append(f"- [{ns}] {key}: {value}")

    lines.append("</verified_user_facts>")
    section = "\n".join(lines)
    if token_cap_chars > 0:
        return section[:token_cap_chars]
    return section


def _build_orchestrator(
    claude_client: AnthropicClient,
    event_emitter: EventEmitter,
    sandbox_provider: SandboxProvider,
    storage_backend: StorageBackend | None = None,
    initial_messages: tuple[dict[str, Any], ...] = (),
    persistent_store: PersistentMemoryStore | None = None,
    mcp_state: MCPState | None = None,
    skill_registry: SkillRegistry | None = None,
    memory_entries: list[dict[str, str]] | None = None,
    conversation_id: str | None = None,
) -> tuple[AgentOrchestrator, ToolExecutor]:
    """Build an AgentOrchestrator using a callback holder to avoid two-phase construction."""
    settings = get_settings()
    callback_holder = _CallbackHolder()

    resolved_mcp_state = mcp_state if mcp_state is not None else MCPState()

    artifact_manager = ArtifactManager(storage_backend=storage_backend)
    registry = _build_base_registry(
        event_emitter,
        callback_holder,
        sandbox_provider,
        storage_backend,
        resolved_mcp_state,
        artifact_manager,
        persistent_store,
        skill_registry,
    )
    executor = ToolExecutor(
        registry=registry,
        sandbox_provider=sandbox_provider,
        event_emitter=event_emitter,
        artifact_manager=artifact_manager,
        conversation_id=conversation_id,
    )

    system_prompt = build_agent_system_prompt(memory_entries, skill_registry)

    orchestrator = AgentOrchestrator(
        claude_client=claude_client,
        tool_registry=registry,
        tool_executor=executor,
        event_emitter=event_emitter,
        system_prompt=system_prompt,
        max_iterations=settings.MAX_ITERATIONS,
        initial_messages=initial_messages,
        thinking_budget=settings.THINKING_BUDGET,
        skill_registry=skill_registry if settings.SKILLS_ENABLED else None,
        persistent_store=persistent_store,
    )
    callback_holder.set(orchestrator.on_task_complete)

    return orchestrator, executor


def _build_planner_orchestrator(
    claude_client: AnthropicClient,
    event_emitter: EventEmitter,
    sandbox_provider: SandboxProvider,
    storage_backend: StorageBackend | None = None,
    persistent_store: PersistentMemoryStore | None = None,
    mcp_state: MCPState | None = None,
    skill_registry: SkillRegistry | None = None,
    memory_entries: list[dict[str, str]] | None = None,
    conversation_id: str | None = None,
) -> tuple[PlannerOrchestrator, ToolExecutor]:
    """Build a PlannerOrchestrator with properly wired sub-agent registries."""
    settings = get_settings()
    callback_holder = _CallbackHolder()

    resolved_mcp_state = mcp_state if mcp_state is not None else MCPState()

    sub_agent_manager = SubAgentManager(
        claude_client=claude_client,
        tool_registry_factory=_build_sub_agent_registry_factory(
            event_emitter, sandbox_provider, resolved_mcp_state
        ),
        tool_executor_factory=lambda reg: ToolExecutor(
            registry=reg,
            sandbox_provider=sandbox_provider,
            event_emitter=event_emitter,
        ),
        event_emitter=event_emitter,
        max_concurrent=settings.MAX_CONCURRENT_AGENTS,
        max_total=settings.MAX_TOTAL_AGENTS,
        max_iterations=settings.MAX_AGENT_ITERATIONS,
    )

    artifact_manager = ArtifactManager(storage_backend=storage_backend)
    base_registry = _build_base_registry(
        event_emitter,
        callback_holder,
        sandbox_provider,
        storage_backend,
        resolved_mcp_state,
        artifact_manager,
        persistent_store,
        skill_registry,
    )
    executor = ToolExecutor(
        registry=base_registry,
        sandbox_provider=sandbox_provider,
        event_emitter=event_emitter,
        artifact_manager=artifact_manager,
        conversation_id=conversation_id,
    )

    from agent.runtime.planner import PLANNER_SYSTEM_PROMPT

    # Append skill catalog to planner system prompt if available
    planner_prompt = PLANNER_SYSTEM_PROMPT
    if skill_registry is not None and settings.SKILLS_ENABLED:
        catalog_section = skill_registry.catalog_prompt_section()
        if catalog_section:
            planner_prompt = PLANNER_SYSTEM_PROMPT + "\n" + catalog_section

    # Append personal memory to planner system prompt
    memory_section = _format_memory_prompt_section(memory_entries or [])
    if memory_section:
        planner_prompt = planner_prompt + "\n" + memory_section

    orchestrator = PlannerOrchestrator(
        claude_client=claude_client,
        tool_registry=base_registry,
        tool_executor=executor,
        event_emitter=event_emitter,
        sub_agent_manager=sub_agent_manager,
        max_iterations=settings.MAX_ITERATIONS,
        system_prompt=planner_prompt,
        skill_registry=skill_registry if settings.SKILLS_ENABLED else None,
    )
    callback_holder.set(orchestrator.on_task_complete)

    return orchestrator, orchestrator._executor
