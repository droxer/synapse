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
            logger.warning(
                "PROXY_SECRET is not set in production — backend is unprotected"
            )
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
        self._requests: dict[str, list[float]] = {}
        self._last_sweep = 0.0

    @property
    def key_count(self) -> int:
        """Return the number of active keys, exposed for tests."""
        return len(self._requests)

    def _sweep_expired_keys(self, window_start: float, now: float) -> None:
        if now - self._last_sweep < self._window:
            return
        self._last_sweep = now
        expired = [
            key
            for key, timestamps in self._requests.items()
            if not timestamps or timestamps[-1] <= window_start
        ]
        for key in expired:
            self._requests.pop(key, None)

    def check(self, key: str) -> bool:
        now = _time.monotonic()
        window_start = now - self._window
        self._sweep_expired_keys(window_start, now)
        requests = [t for t in self._requests.get(key, []) if t > window_start]
        if len(requests) >= self._max:
            self._requests[key] = requests
            return False
        requests.append(now)
        self._requests[key] = requests
        return True


_limiter_cache: dict[str, tuple[int, _RateLimiter]] = {}


def _get_rate_limiter(kind: str, max_requests: int) -> _RateLimiter:
    """Return a cached limiter, refreshing it when config changes."""
    cached = _limiter_cache.get(kind)
    if cached is not None:
        cached_max, limiter = cached
        if cached_max == max_requests:
            return limiter

    limiter = _RateLimiter(max_requests=max_requests)
    _limiter_cache[kind] = (max_requests, limiter)
    return limiter


async def _check_rate_limit(
    request: Request, auth_user: AuthUser | None = None
) -> None:
    """Enforce per-user or per-IP rate limiting (disabled in development).

    Authenticated users get a higher rate limit than anonymous IPs.
    """
    settings = get_settings()
    if settings.ENVIRONMENT == "development":
        return

    # Use user ID if authenticated, otherwise fall back to IP
    if auth_user is not None:
        key = f"user:{auth_user.google_id}"
        limiter = _get_rate_limiter("user", settings.RATE_LIMIT_PER_MINUTE * 2)
    else:
        client_ip = request.client.host if request.client else "unknown"
        key = f"ip:{client_ip}"
        limiter = _get_rate_limiter("ip", settings.RATE_LIMIT_PER_MINUTE)

    if not limiter.check(key):
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


async def _check_rate_limit_with_user(
    request: Request,
    auth_user: AuthUser | None = Depends(get_current_user),
) -> None:
    """Wrapper to inject auth_user into rate limit check."""
    await _check_rate_limit(request, auth_user)


common_dependencies = [Depends(_verify_api_key), Depends(_check_rate_limit_with_user)]
