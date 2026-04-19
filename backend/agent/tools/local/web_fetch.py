"""Fetch and extract text content from a URL."""

from __future__ import annotations

import ipaddress
import re
import socket
import urllib.parse
from typing import Any

import httpx
from loguru import logger

from agent.tools.base import (
    ExecutionContext,
    LocalTool,
    ToolDefinition,
    ToolResult,
)

_BLOCKED_NETWORKS = (
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
)


def _is_private_ip(ip_str: str) -> bool:
    """Return True if *ip_str* belongs to a blocked private/internal network."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True  # unparseable → block
    return any(addr in net for net in _BLOCKED_NETWORKS)


def _validate_url(url: str) -> str | None:
    """Validate URL for SSRF. Returns an error message or None if safe."""
    parsed = urllib.parse.urlparse(url)

    if parsed.scheme not in ("http", "https"):
        return f"URL scheme must be http or https, got '{parsed.scheme}'"

    hostname = parsed.hostname
    if not hostname:
        return "URL has no hostname"

    lower_host = hostname.lower()
    if lower_host == "localhost" or lower_host.endswith(".local"):
        return f"Blocked hostname: {hostname}"

    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return f"Could not resolve hostname: {hostname}"

    for _family, _type, _proto, _canonname, sockaddr in resolved:
        ip_str = sockaddr[0]
        if _is_private_ip(ip_str):
            return f"Hostname {hostname} resolves to private/internal IP {ip_str}"

    return None


_SCRIPT_STYLE_RE = re.compile(
    r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\n{3,}")
_MAX_REDIRECTS = 10


def _strip_html_regex(html: str) -> str:
    """Fallback: remove script/style blocks, then strip remaining HTML tags."""
    text = _SCRIPT_STYLE_RE.sub("", html)
    text = _HTML_TAG_RE.sub("", text)
    text = _WHITESPACE_RE.sub("\n\n", text)
    return text.strip()


def _extract_content(html: str, url: str) -> str:
    """Extract main content using trafilatura, falling back to regex stripping."""
    try:
        import trafilatura

        result = trafilatura.extract(
            html,
            url=url,
            include_links=True,
            include_tables=True,
            include_comments=False,
            favor_recall=True,
            output_format="txt",
        )
        if result:
            return result
    except Exception as exc:
        logger.debug("trafilatura_extraction_failed error={}", exc)
    return _strip_html_regex(html)


async def _fetch_with_safe_redirects(url: str) -> httpx.Response:
    """Fetch a URL while validating every redirect target."""
    current_url = url

    async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
        for redirect_count in range(_MAX_REDIRECTS + 1):
            ssrf_error = _validate_url(current_url)
            if ssrf_error is not None:
                logger.warning(
                    "web_fetch_ssrf_blocked url={} reason={}",
                    current_url,
                    ssrf_error,
                )
                raise ValueError(f"URL blocked: {ssrf_error}")

            response = await client.get(current_url)
            if not response.has_redirect_location:
                response.raise_for_status()
                return response

            if redirect_count >= _MAX_REDIRECTS:
                raise ValueError(f"Too many redirects while fetching {url}")

            location = response.headers.get("location", "").strip()
            if not location:
                raise ValueError("Redirect response missing Location header")
            current_url = urllib.parse.urljoin(current_url, location)

    raise RuntimeError(f"Failed to fetch URL: {url}")


class WebFetch(LocalTool):
    """Fetch a web page and return its text content."""

    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            name="web_fetch",
            description=(
                "Fetch a URL and return its main text content extracted intelligently. "
                "Strips navigation, ads, and boilerplate to return article/page content."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "The URL to fetch.",
                    },
                    "max_length": {
                        "type": "integer",
                        "description": "Maximum character length of returned content.",
                        "default": 20000,
                    },
                },
                "required": ["url"],
            },
            execution_context=ExecutionContext.LOCAL,
            tags=("web", "fetch"),
        )

    async def execute(self, **kwargs: Any) -> ToolResult:
        url: str = kwargs.get("url", "")
        max_length: int = kwargs.get("max_length", 20000)

        if not url.strip():
            return ToolResult.fail("URL must not be empty")

        try:
            response = await _fetch_with_safe_redirects(url)
        except ValueError as exc:
            return ToolResult.fail(str(exc))
        except httpx.HTTPStatusError as exc:
            return ToolResult.fail(f"HTTP {exc.response.status_code}: {exc}")
        except Exception as exc:
            logger.warning("web_fetch_failed url={} error={}", url, exc)
            return ToolResult.fail(f"Fetch failed: {exc}")

        final_url = str(response.url)
        content = _extract_content(response.text, final_url)
        truncated = len(content) > max_length
        content = content[:max_length]

        return ToolResult.ok(
            content,
            metadata={
                "url": final_url,
                "requested_url": url,
                "truncated": truncated,
                "length": len(content),
                "redirected": final_url != url,
            },
        )
