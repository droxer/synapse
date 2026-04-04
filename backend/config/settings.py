from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

TokenCounterStrategy = Literal["weighted", "legacy"]


class Settings(BaseSettings):
    """Application settings loaded from environment variables.

    All fields are immutable after construction (frozen=True).
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        frozen=True,
    )

    ANTHROPIC_API_KEY: str
    ANTHROPIC_BASE_URL: str = "https://api.anthropic.com"
    TAVILY_API_KEY: str
    REDIS_URL: str = "redis://localhost:6379"
    DATABASE_URL: str = "sqlite+aiosqlite:///./hiagent.db"
    PLANNING_MODEL: str = "claude-sonnet-4-20250514"
    TASK_MODEL: str = "claude-sonnet-4-20250514"
    LITE_MODEL: str = "claude-haiku-4-5-20251001"
    MAX_ITERATIONS: int = 50
    MAX_CONCURRENT_AGENTS: int = 5
    MAX_TOTAL_AGENTS: int = 20
    MAX_AGENT_ITERATIONS: int = 50
    AGENT_TIMEOUT_SECONDS: int = 300
    THINKING_BUDGET: int = 10000  # Budget tokens for extended thinking (0 = disabled)
    LOG_LEVEL: str = "INFO"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    CORS_ORIGINS: list[str] = ["http://localhost:3000"]
    SANDBOX_PROVIDER: str = "boxlite"  # "boxlite" or "e2b"
    E2B_API_KEY: str = ""
    IMAGE_PROVIDER: str = "minimax"  # Image generation provider (e.g., "minimax")
    MINIMAX_API_KEY: str = ""
    MINIMAX_API_HOST: str = "https://api.minimaxi.com"  # or https://api.minimax.io
    API_KEY: str = ""  # Optional API key for authentication; empty = allow all
    STORAGE_PROVIDER: str = "local"  # "local" or "r2"
    STORAGE_DIR: str = "./artifacts"  # Local storage directory
    # Cloudflare R2 (required when STORAGE_PROVIDER=r2)
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = ""
    R2_PUBLIC_URL: str = ""  # Optional: public bucket URL for direct access
    MCP_SERVERS: str = ""  # JSON-encoded list of MCP server configs, or empty
    SKILLS_ENABLED: bool = True  # Enable/disable the agent skills system
    SKILLS_REGISTRY_URL: str = "https://api.agentskills.io"  # Remote skill registry
    SKILLS_TRUST_PROJECT: bool = True  # When False, project-level skills are skipped
    ENVIRONMENT: str = "development"  # "development" or "production"
    RATE_LIMIT_PER_MINUTE: int = 30

    # Context compaction
    COMPACT_TOKEN_BUDGET: int = (
        150_000  # Trigger compaction at this estimated token count
    )
    COMPACT_TOKEN_COUNTER: TokenCounterStrategy = "weighted"
    COMPACT_FULL_INTERACTIONS: int = 5  # Hot tier: recent interactions kept verbatim
    COMPACT_FALLBACK_PREVIEW_CHARS: int = 500
    COMPACT_FALLBACK_RESULT_CHARS: int = 1000
    COMPACT_SUMMARY_MODEL: str = (
        ""  # Model for warm-tier summarization (default: LITE_MODEL)
    )
    COMPACT_FULL_DIALOGUE_TURNS: int = 5
    # Max chars for dialogue fallback when summarisation is unavailable
    COMPACT_DIALOGUE_FALLBACK_CHARS: int = 12_000
    # Merge cap for persisted rolling context summaries (OpenClaw-style)
    COMPACT_CONTEXT_SUMMARY_MAX_CHARS: int = 32_000
    # When context_summary is set, load only the last N DB messages on reconstruct
    COMPACT_RECONSTRUCT_TAIL_MESSAGES: int = 80
    # Before compaction, persist heuristic facts from user text in dropped context
    COMPACT_MEMORY_FLUSH: bool = False
    SKILL_SELECTOR_MODEL: str = ""

    # Agent robustness / guardrails
    HANDOFF_MESSAGE_SNIPPET_CHARS: int = 2000
    SKILL_DEPENDENCY_INSTALL_STRICT: bool = False
    STUCK_LOOP_TOOL_REPEAT_THRESHOLD: int = 3
    VALIDATE_AGENT_MESSAGE_CHAIN: bool = False
    MAX_SHELL_TOOLS_PER_TURN: int = 100
    AGENT_GLOBAL_TOKEN_BUDGET: int = 0  # 0 = disabled (sum of sub-agent metrics)
    PARALLEL_SAFE_TOOLS_ENABLED: bool = True

    # Auth (user identity comes from NextAuth via proxy headers)
    AUTH_REQUIRED: bool = False  # When False, unauthenticated requests are allowed
    PROXY_SECRET: str = (
        ""  # Shared secret between Next.js proxy and backend; required in production
    )
    # Channels (IM integrations — Telegram, etc.)
    CHANNELS_ENABLED: bool = False  # Feature flag for channel integrations
    CHANNELS_WEBHOOK_BASE_URL: str = (
        ""  # Optional public base URL override for per-user webhook setup
    )

    # Telegram long-term memory fact compression
    MEMORY_FACT_CONFIDENCE_THRESHOLD: float = 0.85
    MEMORY_FACT_TOP_K: int = 8
    MEMORY_FACT_PROMPT_TOKEN_CAP: int = 1200

    DEFAULT_SYSTEM_PROMPT: str = (
        "You are the user's coding and research copilot with access to a sandboxed environment "
        "where you can write and execute code, manage files, browse the web, and more.\n\n"
        "## Guidelines\n"
        '- Do not open replies by naming a vendor, product, or model (e.g. "Claude") or with a '
        'generic self-introduction as an "AI assistant" — in any language. Start with the '
        "substance of the answer.\n"
        "- Always write real, working code. Execute it to verify before presenting results.\n"
        "- When a task matches an available skill, activate the skill BEFORE starting work "
        "to get expert methodology — skills provide strategies and quality standards, "
        "not just tool names.\n"
        "- Think step by step. Break complex tasks into verifiable stages.\n"
        "- If something fails, read the error and fix it — do not report failure without "
        "attempting a fix."
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached, immutable Settings instance."""
    return Settings()
