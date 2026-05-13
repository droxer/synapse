"""Builder helpers for constructing orchestrators, registries, and sandbox providers."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from loguru import logger

from agent.artifacts.manager import ArtifactManager
from agent.artifacts.storage import StorageBackend
from agent.context.profiles import (
    CompactionProfile,
    CompactionRuntimeKind,
    resolve_compaction_profile,
)
from agent.llm.client import (
    AnthropicClient,
    PromptTextBlock,
    build_system_prompt_blocks,
    render_system_prompt,
)
from agent.llm.image import MiniMaxImageClient
from agent.memory.prompt_sections import (
    format_verified_facts_prompt_section as _format_verified_facts_prompt_section,
)
from agent.memory.store import PersistentMemoryStore
from agent.mcp.bridge import mcp_server_tag
from agent.runtime.orchestrator import AgentOrchestrator
from agent.runtime.planner import PLANNER_SYSTEM_PROMPT, PlannerOrchestrator
from agent.runtime.prompting import PromptAssembly
from agent.runtime.hooks import ConversationHooks
from agent.runtime.system_prompt_sections import (
    build_memory_aware_system_prompt_sections,
    format_memory_prompt_section,
)
from agent.runtime.sub_agent_manager import SubAgentManager
from agent.sandbox.base import SandboxProvider
from agent.skills.loader import SkillRegistry as SkillRegistry
from agent.tools.executor import ToolExecutor
from agent.tools.local.activate_skill import ActivateSkill
from agent.tools.local.ask_user import AskUser
from agent.tools.local.background_tasks import (
    BackgroundTaskManager,
    NotifyUser,
    TaskCancel,
    TaskResume,
    TaskSchedule,
    TaskWatch,
)
from agent.tools.local.image_gen import ImageGen
from agent.tools.local.mcp_resources import (
    MCPGetPrompt,
    MCPListPrompts,
    MCPListResources,
    MCPReadResource,
)
from agent.tools.local.memory_list import MemoryList
from agent.tools.local.memory_recall import MemoryRecall
from agent.tools.local.memory_store import MemoryStore
from agent.tools.local.message_user import MessageUser
from agent.tools.local.markdown_artifact import CreateMarkdownArtifact
from agent.tools.local.structured_interaction import (
    ConfirmAction,
    RequestApproval,
    RequestUserInput,
)
from agent.tools.local.task_complete import TaskComplete
from agent.tools.local.exa_web_search import ExaWebSearch
from agent.tools.local.web_fetch import WebFetch
from agent.tools.local.web_search import TavilyWebSearch
from agent.tools.registry import ToolRegistry
from agent.tools.sandbox.browser import BrowserUse
from agent.tools.sandbox.browser_session_tools import (
    BrowserDownloads,
    BrowserSessionLoad,
    BrowserSessionSave,
    BrowserUpload,
)
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
from agent.tools.sandbox.office_tools import (
    DocumentEdit,
    DocumentWrite,
    FileConvert,
    SlidesCreate,
    SlidesEdit,
    SpreadsheetEdit,
    SpreadsheetRead,
    SpreadsheetWrite,
)
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


def _register_web_search_provider(
    registry: ToolRegistry, settings: Any
) -> ToolRegistry:
    """Register exactly one provider-backed web_search tool."""
    provider = getattr(settings, "SEARCH_PROVIDER", "tavily")
    if provider == "tavily":
        api_key = getattr(settings, "TAVILY_API_KEY", "")
        if not api_key:
            raise RuntimeError("SEARCH_PROVIDER=tavily but TAVILY_API_KEY is not set")
        return registry.register(TavilyWebSearch(api_key=api_key))
    if provider == "exa":
        api_key = getattr(settings, "EXA_API_KEY", "")
        if not api_key:
            raise RuntimeError("SEARCH_PROVIDER=exa but EXA_API_KEY is not set")
        return registry.register(ExaWebSearch(api_key=api_key, tool_name="web_search"))

    raise ValueError(
        f"Unknown SEARCH_PROVIDER={provider!r}. Must be 'tavily' or 'exa'."
    )


def _visible_mcp_server_keys(
    mcp_state: MCPState,
    user_id: Any | None,
) -> set[str]:
    """Return MCP server keys visible to the current conversation."""
    return set(mcp_state.configs_for_user(user_id))


def _mcp_registry_for_user(
    mcp_state: MCPState,
    user_id: Any | None,
) -> ToolRegistry | None:
    """Return only bridged MCP tools visible to the current conversation."""
    if mcp_state.registry is None:
        return None

    server_tags = {
        mcp_server_tag(server_key)
        for server_key in _visible_mcp_server_keys(mcp_state, user_id)
    }
    return mcp_state.registry.filter_by_names_or_tags(set(), server_tags)


def _register_visible_mcp_tools(
    registry: ToolRegistry,
    mcp_state: MCPState,
    user_id: Any | None,
) -> ToolRegistry:
    """Register MCP bridged and helper tools scoped to the current user."""
    visible_mcp_registry = _mcp_registry_for_user(mcp_state, user_id)
    if visible_mcp_registry is not None:
        registry = registry.merge(visible_mcp_registry)
    registry = registry.register(MCPListResources(mcp_state, user_id=user_id))
    registry = registry.register(MCPReadResource(mcp_state, user_id=user_id))
    registry = registry.register(MCPListPrompts(mcp_state, user_id=user_id))
    registry = registry.register(MCPGetPrompt(mcp_state, user_id=user_id))
    return registry


def _build_base_registry(
    event_emitter: EventEmitter,
    on_complete: Any,
    sandbox_provider: SandboxProvider,
    storage_backend: StorageBackend | None,
    mcp_state: MCPState,
    artifact_manager: ArtifactManager | None = None,
    persistent_store: PersistentMemoryStore | None = None,
    skill_registry: SkillRegistry | None = None,
    mcp_user_id: Any | None = None,
) -> ToolRegistry:
    """Build the shared tool registry with all standard tools registered."""
    settings = get_settings()
    memory: dict[str, str] = {}
    background_tasks = BackgroundTaskManager(event_emitter)

    registry = ToolRegistry()
    # Local tools
    registry = _register_web_search_provider(registry, settings)
    registry = registry.register(WebFetch())
    registry = registry.register(MessageUser(event_emitter=event_emitter))
    if artifact_manager is not None:
        registry = registry.register(
            CreateMarkdownArtifact(
                artifact_manager=artifact_manager,
                event_emitter=event_emitter,
            )
        )
    registry = registry.register(AskUser(event_emitter=event_emitter))
    registry = registry.register(TaskComplete(on_complete=on_complete))
    registry = registry.register(RequestUserInput(event_emitter=event_emitter))
    registry = registry.register(RequestApproval(event_emitter=event_emitter))
    registry = registry.register(ConfirmAction(event_emitter=event_emitter))
    registry = registry.register(NotifyUser(event_emitter=event_emitter))
    registry = registry.register(TaskSchedule(background_tasks))
    registry = registry.register(TaskWatch(background_tasks))
    registry = registry.register(TaskResume(background_tasks))
    registry = registry.register(TaskCancel(background_tasks))
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
    registry = registry.register(SpreadsheetRead())
    registry = registry.register(SpreadsheetWrite())
    registry = registry.register(SpreadsheetEdit())
    registry = registry.register(DocumentWrite())
    registry = registry.register(DocumentEdit())
    registry = registry.register(SlidesCreate())
    registry = registry.register(SlidesEdit())
    registry = registry.register(FileConvert())
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
    registry = registry.register(BrowserSessionSave())
    registry = registry.register(BrowserSessionLoad())
    registry = registry.register(BrowserDownloads())
    registry = registry.register(BrowserUpload())
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

    registry = _register_visible_mcp_tools(registry, mcp_state, mcp_user_id)

    # Register activate_skill tool if skills are enabled
    if skill_registry is not None and settings.SKILLS_ENABLED:
        registry = registry.register(ActivateSkill(skill_registry=skill_registry))

    return registry


def _build_planner_registry(
    event_emitter: EventEmitter,
    on_complete: Any,
    mcp_state: MCPState,
    persistent_store: PersistentMemoryStore | None = None,
    skill_registry: SkillRegistry | None = None,
    artifact_manager: ArtifactManager | None = None,
    mcp_user_id: Any | None = None,
) -> ToolRegistry:
    """Build the planner-only registry without sandbox execution tools."""
    settings = get_settings()
    memory: dict[str, str] = {}
    background_tasks = BackgroundTaskManager(event_emitter)

    registry = ToolRegistry()
    registry = _register_web_search_provider(registry, settings)
    registry = registry.register(WebFetch())
    registry = registry.register(MessageUser(event_emitter=event_emitter))
    if artifact_manager is not None:
        registry = registry.register(
            CreateMarkdownArtifact(
                artifact_manager=artifact_manager,
                event_emitter=event_emitter,
            )
        )
    registry = registry.register(AskUser(event_emitter=event_emitter))
    registry = registry.register(TaskComplete(on_complete=on_complete))
    registry = registry.register(RequestUserInput(event_emitter=event_emitter))
    registry = registry.register(RequestApproval(event_emitter=event_emitter))
    registry = registry.register(ConfirmAction(event_emitter=event_emitter))
    registry = registry.register(NotifyUser(event_emitter=event_emitter))
    registry = registry.register(TaskSchedule(background_tasks))
    registry = registry.register(TaskWatch(background_tasks))
    registry = registry.register(TaskResume(background_tasks))
    registry = registry.register(TaskCancel(background_tasks))
    registry = registry.register(
        MemoryStore(store=memory, persistent_store=persistent_store)
    )
    registry = registry.register(
        MemoryRecall(store=memory, persistent_store=persistent_store)
    )
    registry = registry.register(
        MemoryList(store=memory, persistent_store=persistent_store)
    )
    registry = _register_visible_mcp_tools(registry, mcp_state, mcp_user_id)

    if skill_registry is not None and settings.SKILLS_ENABLED:
        registry = registry.register(ActivateSkill(skill_registry=skill_registry))

    return registry


def _build_sub_agent_registry_factory(
    event_emitter: EventEmitter,
    sandbox_provider: SandboxProvider,
    mcp_state: MCPState,
    persistent_store: PersistentMemoryStore | None = None,
    skill_registry: SkillRegistry | None = None,
    mcp_user_id: Any | None = None,
) -> Callable[[], ToolRegistry]:
    """Factory that produces fully-populated registries for sub-agents (C1 fix)."""

    def factory() -> ToolRegistry:
        settings = get_settings()
        memory: dict[str, str] = {}
        background_tasks = BackgroundTaskManager(event_emitter)
        registry = ToolRegistry()
        registry = _register_web_search_provider(registry, settings)
        registry = registry.register(WebFetch())
        registry = registry.register(MessageUser(event_emitter=event_emitter))
        registry = registry.register(NotifyUser(event_emitter=event_emitter))
        registry = registry.register(RequestUserInput(event_emitter=event_emitter))
        registry = registry.register(RequestApproval(event_emitter=event_emitter))
        registry = registry.register(ConfirmAction(event_emitter=event_emitter))
        registry = registry.register(TaskSchedule(background_tasks))
        registry = registry.register(TaskWatch(background_tasks))
        registry = registry.register(TaskResume(background_tasks))
        registry = registry.register(TaskCancel(background_tasks))
        registry = registry.register(
            MemoryStore(store=memory, persistent_store=persistent_store)
        )
        registry = registry.register(
            MemoryRecall(store=memory, persistent_store=persistent_store)
        )
        registry = registry.register(
            MemoryList(store=memory, persistent_store=persistent_store)
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
        registry = registry.register(SpreadsheetRead())
        registry = registry.register(SpreadsheetWrite())
        registry = registry.register(SpreadsheetEdit())
        registry = registry.register(DocumentWrite())
        registry = registry.register(DocumentEdit())
        registry = registry.register(SlidesCreate())
        registry = registry.register(SlidesEdit())
        registry = registry.register(FileConvert())
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
        registry = registry.register(BrowserSessionSave())
        registry = registry.register(BrowserSessionLoad())
        registry = registry.register(BrowserDownloads())
        registry = registry.register(BrowserUpload())
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

        registry = _register_visible_mcp_tools(registry, mcp_state, mcp_user_id)

        if skill_registry is not None and settings.SKILLS_ENABLED:
            registry = registry.register(ActivateSkill(skill_registry=skill_registry))

        return registry

    return factory


# ---------------------------------------------------------------------------
# Orchestrator builders
# ---------------------------------------------------------------------------

RESULT_DELIVERY_PROMPT_SECTION = """<result_delivery>
Choose the result surface intentionally:
- Use normal conversation text for concise answers, direct Q&A, status updates, and short implementation summaries.
- Use create_markdown_artifact for substantial reports, audits, research results, comparisons, or long structured deliverables that are better reviewed in the artifacts panel.
- When you create a Markdown artifact, put the complete result in the artifact and keep the conversation response brief: name what was created and mention that it is available in artifacts. Do not duplicate the full artifact content in the conversation.
</result_delivery>"""


def _format_memory_prompt_section(
    memory_entries: list[dict[str, str]],
) -> str:
    """Format memory entries as a system prompt section."""
    return format_memory_prompt_section(memory_entries, settings=get_settings())


def build_agent_system_prompt(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> str:
    """Assemble the same system prompt string used by the main orchestrator."""
    return render_system_prompt(
        build_default_agent_system_prompt_sections(memory_entries, skill_registry)
    )


def build_agent_system_prompt_sections(
    base_prompt: str,
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> tuple[PromptTextBlock, ...]:
    """Assemble system-prompt sections without flattening them."""
    sections = build_memory_aware_system_prompt_sections(
        base_prompt,
        memory_entries,
        skill_registry,
        settings=get_settings(),
    )
    return (*sections, PromptTextBlock(text=RESULT_DELIVERY_PROMPT_SECTION))


def build_agent_prompt_assembly(
    base_prompt: str,
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> PromptAssembly:
    """Assemble cache-aware prompt sections with user memory kept volatile."""
    settings = get_settings()
    stable_sections = build_memory_aware_system_prompt_sections(
        base_prompt,
        None,
        skill_registry,
        settings=settings,
    )
    memory_section = format_memory_prompt_section(
        memory_entries or [],
        settings=settings,
    )
    if memory_section:
        return PromptAssembly(
            stable_sections=stable_sections,
            volatile_sections=build_system_prompt_blocks(
                memory_section,
                RESULT_DELIVERY_PROMPT_SECTION,
            ),
        )
    return PromptAssembly(
        stable_sections=(
            *stable_sections,
            PromptTextBlock(text=RESULT_DELIVERY_PROMPT_SECTION),
        ),
    )


def build_default_agent_system_prompt_sections(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> tuple[PromptTextBlock, ...]:
    """Assemble default agent system-prompt sections."""
    settings = get_settings()
    return build_agent_system_prompt_sections(
        settings.DEFAULT_SYSTEM_PROMPT,
        memory_entries,
        skill_registry,
    )


def build_planner_system_prompt_sections(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> tuple[PromptTextBlock, ...]:
    """Assemble planner system-prompt sections."""
    return build_agent_system_prompt_sections(
        PLANNER_SYSTEM_PROMPT,
        memory_entries,
        skill_registry,
    )


def build_default_agent_prompt_assembly(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> PromptAssembly:
    """Assemble default agent prompt sections with cache boundaries."""
    settings = get_settings()
    return build_agent_prompt_assembly(
        settings.DEFAULT_SYSTEM_PROMPT,
        memory_entries,
        skill_registry,
    )


def build_planner_prompt_assembly(
    memory_entries: list[dict[str, str]] | None,
    skill_registry: SkillRegistry | None,
) -> PromptAssembly:
    """Assemble planner prompt sections with cache boundaries."""
    return build_agent_prompt_assembly(
        PLANNER_SYSTEM_PROMPT,
        memory_entries,
        skill_registry,
    )


def format_verified_facts_prompt_section(
    facts: list[dict[str, str]],
    token_cap_chars: int,
) -> str:
    """Compatibility wrapper for verified fact prompt formatting."""
    return _format_verified_facts_prompt_section(facts, token_cap_chars)


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
    compaction_runtime: CompactionRuntimeKind = "web_conversation",
    compaction_profile: CompactionProfile | None = None,
    mcp_user_id: Any | None = None,
    conversation_hooks: ConversationHooks | None = None,
) -> tuple[AgentOrchestrator, ToolExecutor]:
    """Build an AgentOrchestrator using a callback holder to avoid two-phase construction."""
    settings = get_settings()
    callback_holder = _CallbackHolder()
    resolved_profile = compaction_profile or resolve_compaction_profile(
        settings, compaction_runtime
    )

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
        mcp_user_id,
    )
    executor = ToolExecutor(
        registry=registry,
        sandbox_provider=sandbox_provider,
        event_emitter=event_emitter,
        artifact_manager=artifact_manager,
        conversation_id=conversation_id,
    )

    system_prompt = build_default_agent_prompt_assembly(memory_entries, skill_registry)

    orchestrator = AgentOrchestrator(
        claude_client=claude_client,
        tool_registry=registry,
        tool_executor=executor,
        event_emitter=event_emitter,
        system_prompt=system_prompt,
        max_iterations=settings.MAX_ITERATIONS,
        compaction_profile=resolved_profile,
        initial_messages=initial_messages,
        thinking_budget=settings.THINKING_BUDGET,
        skill_registry=skill_registry if settings.SKILLS_ENABLED else None,
        persistent_store=persistent_store,
        conversation_hooks=conversation_hooks,
        conversation_id=conversation_id,
        hook_user_id=mcp_user_id,
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
    initial_messages: tuple[dict[str, Any], ...] = (),
    compaction_runtime: CompactionRuntimeKind = "planner",
    compaction_profile: CompactionProfile | None = None,
    mcp_user_id: Any | None = None,
    conversation_hooks: ConversationHooks | None = None,
) -> tuple[PlannerOrchestrator, ToolExecutor]:
    """Build a PlannerOrchestrator with properly wired sub-agent registries."""
    settings = get_settings()
    callback_holder = _CallbackHolder()
    resolved_profile = compaction_profile or resolve_compaction_profile(
        settings, compaction_runtime
    )

    resolved_mcp_state = mcp_state if mcp_state is not None else MCPState()
    artifact_manager = ArtifactManager(storage_backend=storage_backend)

    sub_agent_manager = SubAgentManager(
        claude_client=claude_client,
        tool_registry_factory=_build_sub_agent_registry_factory(
            event_emitter,
            sandbox_provider,
            resolved_mcp_state,
            persistent_store,
            skill_registry if settings.SKILLS_ENABLED else None,
            mcp_user_id,
        ),
        tool_executor_factory=lambda reg: ToolExecutor(
            registry=reg,
            sandbox_provider=sandbox_provider,
            event_emitter=event_emitter,
            artifact_manager=artifact_manager,
            conversation_id=conversation_id,
        ),
        event_emitter=event_emitter,
        max_concurrent=settings.MAX_CONCURRENT_AGENTS,
        max_total=settings.MAX_TOTAL_AGENTS,
        max_iterations=settings.MAX_AGENT_ITERATIONS,
        skill_registry=skill_registry if settings.SKILLS_ENABLED else None,
        persistent_store=persistent_store,
        memory_entries=memory_entries,
    )

    planner_registry = _build_planner_registry(
        event_emitter,
        callback_holder,
        resolved_mcp_state,
        persistent_store,
        skill_registry,
        artifact_manager,
        mcp_user_id,
    )
    executor = ToolExecutor(
        registry=planner_registry,
        sandbox_provider=sandbox_provider,
        event_emitter=event_emitter,
        artifact_manager=artifact_manager,
        conversation_id=conversation_id,
    )

    planner_prompt = build_planner_prompt_assembly(memory_entries, skill_registry)

    orchestrator = PlannerOrchestrator(
        claude_client=claude_client,
        tool_registry=planner_registry,
        tool_executor=executor,
        event_emitter=event_emitter,
        sub_agent_manager=sub_agent_manager,
        max_iterations=settings.MAX_ITERATIONS,
        compaction_profile=resolved_profile,
        system_prompt=planner_prompt,
        skill_registry=skill_registry if settings.SKILLS_ENABLED else None,
        initial_messages=initial_messages,
        persistent_store=persistent_store,
        conversation_hooks=conversation_hooks,
        conversation_id=conversation_id,
        hook_user_id=mcp_user_id,
    )
    callback_holder.set(orchestrator.on_task_complete)

    return orchestrator, orchestrator._executor
