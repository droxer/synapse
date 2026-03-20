"""Authentication and rate limiting middleware for the API layer.

User identity is provided by the NextAuth middleware in the Next.js frontend,
which injects trusted headers (X-User-Email, X-User-Name, X-User-Picture,
X-User-Google-Id) into proxied API requests.

SECURITY: The backend verifies a shared PROXY_SECRET header to ensure requests
originate from the trusted Next.js proxy, not from an attacker calling the
backend directly. In production, PROXY_SECRET must be set.
"""

from __future__ import annotations

import hmac
import re
import time as _time
from collections import defaultdict
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger

from config.settings import get_settings

_security = HTTPBearer(auto_error=False)

_MAX_HEADER_LEN = 512
_HTTPS_URL_RE = re.compile(r"^https://[^\s]+$")


# ---------------------------------------------------------------------------
# Authenticated user context
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AuthUser:
    """Authenticated user extracted from trusted proxy headers."""

    google_id: str
    email: str
    name: str
    picture: str | None


# ---------------------------------------------------------------------------
# Proxy secret verification
# ---------------------------------------------------------------------------


def _verify_proxy_secret(request: Request) -> None:
    """Verify the shared secret between the Next.js proxy and this backend.

    Skipped when PROXY_SECRET is empty (development mode).
    In production, PROXY_SECRET must be configured.
    """
    settings = get_settings()
    if not settings.PROXY_SECRET:
        if settings.ENVIRONMENT == "production":
            logger.warning("PROXY_SECRET is not set in production — backend is unprotected")
        return

    provided = request.headers.get("x-proxy-secret", "")
    if not hmac.compare_digest(provided, settings.PROXY_SECRET):
        raise HTTPException(status_code=403, detail="Forbidden")


# ---------------------------------------------------------------------------
# API key verification (legacy)
# ---------------------------------------------------------------------------


async def _verify_api_key(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
) -> None:
    """Verify API key if one is configured. No-op when API_KEY is empty."""
    settings = get_settings()
    if not settings.API_KEY:
        return
    if credentials is None or credentials.credentials != settings.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------


class _RateLimiter:
    """Simple in-memory sliding-window rate limiter."""

    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self._max = max_requests
        self._window = window_seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str) -> bool:
        now = _time.monotonic()
        window_start = now - self._window
        self._requests[key] = [t for t in self._requests[key] if t > window_start]
        if len(self._requests[key]) >= self._max:
            return False
        self._requests[key].append(now)
        return True


_rate_limiter = _RateLimiter(max_requests=get_settings().RATE_LIMIT_PER_MINUTE)


async def _check_rate_limit(request: Request) -> None:
    """Enforce per-IP rate limiting (disabled in development)."""
    settings = get_settings()
    if settings.ENVIRONMENT == "development":
        return
    client_ip = request.client.host if request.client else "unknown"
    if not _rate_limiter.check(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")


# ---------------------------------------------------------------------------
# User identity from NextAuth proxy headers
# ---------------------------------------------------------------------------


async def get_current_user(request: Request) -> AuthUser | None:
    """Extract user identity from trusted proxy headers.

    Verifies the proxy secret first, then extracts user identity.
    Returns None if no user headers are present and AUTH_REQUIRED is False.
    Raises 401 if AUTH_REQUIRED is True and no user identity is found.
    """
    _verify_proxy_secret(request)

    settings = get_settings()

    google_id = request.headers.get("x-user-google-id", "").strip()[:_MAX_HEADER_LEN]
    email = request.headers.get("x-user-email", "").strip()[:_MAX_HEADER_LEN]

    if not google_id or not email:
        if settings.AUTH_REQUIRED:
            raise HTTPException(status_code=401, detail="Authentication required")
        return None

    name = request.headers.get("x-user-name", "").strip()[:_MAX_HEADER_LEN] or email
    picture_raw = request.headers.get("x-user-picture", "").strip()[:_MAX_HEADER_LEN]
    picture = picture_raw if _HTTPS_URL_RE.match(picture_raw) else None

    return AuthUser(
        google_id=google_id,
        email=email,
        name=name,
        picture=picture,
    )


# ---------------------------------------------------------------------------
# Common dependencies applied to all protected routes
# ---------------------------------------------------------------------------

common_dependencies = [Depends(_verify_api_key), Depends(_check_rate_limit)]
