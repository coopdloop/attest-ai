"""
recon_agent_tools — MCP tool server for the Recon Agent.

Implements:
  - enumerate_subdomains: passive subdomain discovery via DNS brute-force
  - shodan_host_lookup: passive host info from Shodan
  - dns_resolve: DNS A/AAAA/MX/TXT lookup
  - passive_dns_history: placeholder for pDNS sources

All tools enforce scope before execution.
"""

from __future__ import annotations

import os
import ipaddress
import socket
from typing import Any

import dns.resolver
import httpx
import yaml
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="recon_agent_tools", version="0.1.0")

SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
SCOPE_CONFIG_PATH = os.getenv("SCOPE_CONFIG_PATH", "/config/scope.yaml")

_scope: dict[str, Any] = {}


def _load_scope() -> None:
    global _scope
    try:
        with open(SCOPE_CONFIG_PATH) as f:
            _scope = yaml.safe_load(f) or {}
    except FileNotFoundError:
        _scope = {"scope": {"allowlist": [], "denylist": []}}


def _in_scope(target: str) -> bool:
    """Return True if the target is explicitly allowed and not denied."""
    scope = _scope.get("scope", {})
    allowlist = scope.get("allowlist", [])
    denylist = scope.get("denylist", [])

    # Always block denylist
    for denied in denylist:
        try:
            net = ipaddress.ip_network(denied, strict=False)
            resolved = socket.gethostbyname(target)
            if ipaddress.ip_address(resolved) in net:
                return False
        except Exception:
            if target.endswith(denied) or target == denied:
                return False

    # If allowlist empty, deny all (fail closed)
    if not allowlist:
        return False

    for allowed in allowlist:
        if target == allowed or target.endswith(f".{allowed}"):
            return True

    return False


@app.on_event("startup")
async def startup() -> None:
    _load_scope()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


# ── MCP tool endpoints ────────────────────────────────────────────────────────

class EnumerateSubdomainsRequest(BaseModel):
    domain: str
    wordlist: list[str] | None = None


class ToolResult(BaseModel):
    tool: str
    target: str
    result: Any
    source: str
    timestamp: str


@app.post("/tools/enumerate_subdomains")
async def enumerate_subdomains(req: EnumerateSubdomainsRequest) -> dict:
    """Passive subdomain discovery using DNS lookups against a wordlist."""
    if not _in_scope(req.domain):
        raise HTTPException(status_code=403, detail=f"Target {req.domain!r} is not in scope")

    wordlist = req.wordlist or _default_wordlist()
    found = []

    resolver = dns.resolver.Resolver()
    resolver.timeout = 2
    resolver.lifetime = 2

    for sub in wordlist:
        fqdn = f"{sub}.{req.domain}"
        try:
            answers = resolver.resolve(fqdn, "A")
            found.append({
                "fqdn": fqdn,
                "ips": [str(r) for r in answers],
                "source": "dns_a_record",
            })
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer, dns.exception.Timeout):
            pass
        except Exception:
            pass

    return {
        "tool": "enumerate_subdomains",
        "domain": req.domain,
        "found": found,
        "count": len(found),
    }


class DNSResolveRequest(BaseModel):
    target: str
    record_types: list[str] = ["A", "AAAA", "MX", "TXT"]


@app.post("/tools/dns_resolve")
async def dns_resolve(req: DNSResolveRequest) -> dict:
    if not _in_scope(req.target):
        raise HTTPException(status_code=403, detail=f"Target {req.target!r} is not in scope")

    resolver = dns.resolver.Resolver()
    results: dict[str, list[str]] = {}

    for rtype in req.record_types:
        try:
            answers = resolver.resolve(req.target, rtype)
            results[rtype] = [str(r) for r in answers]
        except Exception:
            results[rtype] = []

    return {"tool": "dns_resolve", "target": req.target, "records": results}


class ShodanLookupRequest(BaseModel):
    target: str  # IP or hostname


@app.post("/tools/shodan_host_lookup")
async def shodan_host_lookup(req: ShodanLookupRequest) -> dict:
    if not _in_scope(req.target):
        raise HTTPException(status_code=403, detail=f"Target {req.target!r} is not in scope")

    if not SHODAN_API_KEY:
        return {"tool": "shodan_host_lookup", "target": req.target, "result": None,
                "note": "SHODAN_API_KEY not configured"}

    try:
        ip = socket.gethostbyname(req.target)
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.shodan.io/shodan/host/{ip}",
                params={"key": SHODAN_API_KEY},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Shodan lookup failed: {e}")

    # Return structured, sanitised result (strip account fields per harness policy)
    return {
        "tool": "shodan_host_lookup",
        "target": req.target,
        "ip": ip,
        "ports": data.get("ports", []),
        "hostnames": data.get("hostnames", []),
        "country_code": data.get("country_code"),
        "org": data.get("org"),
        "isp": data.get("isp"),
        "vulns": list(data.get("vulns", {}).keys()),
        "source": "shodan",
    }


@app.post("/tools/passive_dns_history")
async def passive_dns_history(target: str) -> dict:
    """Placeholder — integrate pDNS provider (SecurityTrails, VirusTotal, etc.)."""
    if not _in_scope(target):
        raise HTTPException(status_code=403, detail=f"Target {target!r} is not in scope")
    return {"tool": "passive_dns_history", "target": target, "records": [],
            "note": "pDNS provider not yet configured"}


def _default_wordlist() -> list[str]:
    return [
        "www", "mail", "ftp", "vpn", "api", "dev", "staging", "test", "admin",
        "portal", "auth", "sso", "cdn", "static", "assets", "app", "secure",
        "remote", "ns1", "ns2", "smtp", "pop", "imap", "webmail",
    ]
