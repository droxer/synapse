"""Remote skill registry client for browsing/installing from agentskills.io."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from loguru import logger

from agent.skills.installer import SkillInstaller
from agent.skills.models import SkillCatalogEntry, SkillContent


@dataclass(frozen=True)
class SkillRegistryEntry:
    """Full metadata for a skill from the remote registry."""

    name: str
    description: str
    author: str
    version: str
    repo_url: str
    download_url: str
    license: str
    tags: tuple[str, ...]


class SkillRegistryClient:
    """Client for browsing and installing skills from a remote registry."""

    def __init__(
        self,
        registry_url: str = "https://api.agentskills.io",
        installer: SkillInstaller | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._registry_url = registry_url.rstrip("/")
        self._installer = installer
        self._shared_client = http_client

    async def _request(
        self, method: str, path: str, **kwargs: Any
    ) -> httpx.Response:
        """Issue an HTTP request, reusing a shared client if available."""
        url = f"{self._registry_url}{path}"
        if self._shared_client is not None:
            response = await self._shared_client.request(method, url, **kwargs)
            response.raise_for_status()
            return response

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(method, url, **kwargs)
            response.raise_for_status()
            return response

    async def search(self, query: str) -> tuple[SkillCatalogEntry, ...]:
        """Search the remote registry for skills matching a query."""
        try:
            response = await self._request(
                "GET",
                "/skills/search",
                params={"q": query},
            )
            data = response.json()
        except httpx.HTTPError as exc:
            logger.warning("Registry search failed: {}", exc)
            return ()

        results = data.get("results", [])
        return tuple(
            SkillCatalogEntry(
                name=r.get("name", ""),
                description=r.get("description", ""),
            )
            for r in results
            if r.get("name")
        )

    async def get_detail(self, name: str) -> SkillRegistryEntry | None:
        """Get full metadata for a skill from the registry."""
        try:
            response = await self._request("GET", f"/skills/{name}")
            data = response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                return None
            logger.warning("Registry detail request failed: {}", exc)
            return None
        except httpx.HTTPError as exc:
            logger.warning("Registry detail request failed: {}", exc)
            return None

        return _parse_registry_entry(data)

    async def install(self, name: str) -> SkillContent:
        """Download and install a skill from the registry.

        Raises
        ------
        ValueError if the skill is not found or installer is not configured.
        RuntimeError on installation failure.
        """
        if self._installer is None:
            raise ValueError("No installer configured for registry client")

        detail = await self.get_detail(name)
        if detail is None:
            raise ValueError(f"Skill '{name}' not found in registry")

        # Prefer git install if repo URL is available
        if detail.repo_url:
            return await self._installer.install_from_git(detail.repo_url)

        if detail.download_url:
            return await self._installer.install_from_url(detail.download_url)

        raise ValueError(f"Skill '{name}' has no download URL or repo URL in registry")


def _parse_registry_entry(data: dict[str, Any]) -> SkillRegistryEntry:
    """Parse a registry API response into a SkillRegistryEntry."""
    return SkillRegistryEntry(
        name=data.get("name", ""),
        description=data.get("description", ""),
        author=data.get("author", ""),
        version=data.get("version", ""),
        repo_url=data.get("repo_url", ""),
        download_url=data.get("download_url", ""),
        license=data.get("license", ""),
        tags=tuple(data.get("tags", [])),
    )
