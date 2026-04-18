"""Centralized loguru configuration for the backend."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
import logging
import sys

from loguru import logger

_CONVERSATION_ID: ContextVar[str] = ContextVar("conversation_id", default="-")


def set_log_conversation_id(conversation_id: str) -> Token[str]:
    """Set the current conversation id for log correlation."""
    return _CONVERSATION_ID.set(conversation_id)


def reset_log_conversation_id(token: Token[str]) -> None:
    """Reset the conversation id context using a previously returned token."""
    _CONVERSATION_ID.reset(token)


@contextmanager
def conversation_log_context(conversation_id: str):
    """Temporarily bind a conversation id to all logs in the current context."""
    token = set_log_conversation_id(conversation_id)
    try:
        yield
    finally:
        reset_log_conversation_id(token)


def _inject_conversation_context(record: dict) -> None:
    """Attach the current conversation identifier to every log record."""
    record["extra"]["conversation_id"] = _CONVERSATION_ID.get()


class InterceptHandler(logging.Handler):
    """Route stdlib logging into loguru.

    Captures log records from third-party libraries (uvicorn, httpx, etc.)
    and re-emits them through loguru so all output is unified.
    """

    def emit(self, record: logging.LogRecord) -> None:
        # Find the loguru level that matches the stdlib level name
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno  # type: ignore[assignment]

        # Find caller from where the logged message originated
        frame, depth = logging.currentframe(), 2
        while frame and frame.f_code.co_filename == logging.__file__:
            frame = frame.f_back
            depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def setup_logging(log_level: str = "INFO") -> None:
    """Configure loguru as the sole logging backend.

    - Removes the default loguru handler.
    - Adds a single stderr handler with the given level and a concise format.
    - Installs an InterceptHandler on the root stdlib logger so that
      third-party libraries (uvicorn, httpx, etc.) route through loguru.

    Args:
        log_level: Minimum log level (e.g. "DEBUG", "INFO", "WARNING").
    """
    # Remove default loguru handler
    logger.remove()
    logger.configure(patcher=_inject_conversation_context)

    # Add our handler
    logger.add(
        sys.stderr,
        level=log_level.upper(),
        format=(
            "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
            "<level>{level: <8}</level> | "
            "<magenta>{extra[conversation_id]: <36}</magenta> | "
            "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
            "<level>{message}</level>"
        ),
        colorize=True,
    )

    # Intercept stdlib logging
    logging.basicConfig(handlers=[InterceptHandler()], level=0, force=True)

    # Quiet noisy third-party loggers
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "httpx"):
        stdlib_logger = logging.getLogger(name)
        stdlib_logger.handlers = [InterceptHandler()]
        stdlib_logger.propagate = False
