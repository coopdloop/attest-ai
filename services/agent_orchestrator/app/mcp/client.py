"""
MCP client — calls tool servers via HTTP (FastAPI endpoints).

Each tool server (recon, threat_intel, redteam) exposes tools at /tools/<tool_name>.
The orchestrator calls them here and returns structured tool I/O.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import yaml


class MCPClient:
    """HTTP client for calling MCP tool servers registered in mcp_servers.yaml."""

    def __init__(self, registry_path: str) -> None:
        self._servers: dict[str, dict] = {}
        self._load_registry(registry_path)

    def _load_registry(self, path: str) -> None:
        try:
            with open(path) as f:
                config = yaml.safe_load(f)
            for name, cfg in config.get("servers", {}).items():
                url = cfg.get("url", "")
                # Expand env vars in URL
                for key, val in os.environ.items():
                    url = url.replace(f"${{{key}}}", val)
                    url = url.replace(f"${{{key}:-{val}}}", val)
                self._servers[name] = {"url": url, "description": cfg.get("description", "")}
        except FileNotFoundError:
            pass  # Will return errors on tool call

    async def call_tool(self, server: str, tool: str, params: dict[str, Any]) -> dict[str, Any]:
        """Invoke a tool on a registered MCP server."""
        server_cfg = self._servers.get(server)
        if not server_cfg:
            return {"error": f"MCP server '{server}' not registered"}

        url = f"{server_cfg['url']}/tools/{tool}"
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=params)
                resp.raise_for_status()
                return resp.json()
        except httpx.HTTPStatusError as e:
            return {"error": f"tool call failed: HTTP {e.response.status_code}", "detail": e.response.text}
        except Exception as e:
            return {"error": f"tool call failed: {e}"}

    def list_servers(self) -> dict[str, dict]:
        return dict(self._servers)
