from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    DATABASE_URL: str = "postgresql+asyncpg://ha:ha@localhost:5432/hiagent"
    PLANNING_MODEL: str = "claude-sonnet-4-20250514"
    TASK_MODEL: str = "claude-sonnet-4-20250514"
    LITE_MODEL: str = "claude-haiku-4-5-20251001"
    MAX_ITERATIONS: int = 50
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

    # Auth (user identity comes from NextAuth via proxy headers)
    AUTH_REQUIRED: bool = False  # When False, unauthenticated requests are allowed
    PROXY_SECRET: str = ""  # Shared secret between Next.js proxy and backend; required in production
    DEFAULT_SYSTEM_PROMPT: str = (
        "You are a helpful AI assistant with access to a sandboxed coding environment "
        "where you can write and execute code, manage files, browse the web, and more.\n\n"
        "## Guidelines\n"
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
