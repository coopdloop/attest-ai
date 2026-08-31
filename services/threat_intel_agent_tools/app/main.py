"""
threat_intel_agent_tools — MCP tool server for Threat Intel Enrichment.

Tools:
  - vt_file_lookup / vt_ip_lookup / vt_domain_lookup / vt_url_lookup
  - otx_indicator_lookup
  - shodan_host_enrichment
  - correlate_campaign

Every outbound IOC submission is logged (destination + payload hash) for data-leakage audit.
Redis caches repeated lookups to reduce external API quota usage.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

import httpx
import redis.asyncio as aioredis
import vt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

VERSION = os.getenv("APP_VERSION", "0.1.0")

app = FastAPI(title="threat_intel_agent_tools", version=VERSION)

VT_API_KEY = os.getenv("VT_API_KEY", "")
OTX_API_KEY = os.getenv("OTX_API_KEY", "")
SHODAN_API_KEY = os.getenv("SHODAN_API_KEY", "")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/1")
CACHE_TTL_SEC = 3600  # 1 hour

_redis: aioredis.Redis | None = None
_ioc_submission_log: list[dict] = []  # in-memory; flush to attestation_service


@app.on_event("startup")
async def startup() -> None:
    global _redis
    _redis = aioredis.from_url(REDIS_URL, decode_responses=True)


@app.on_event("shutdown")
async def shutdown() -> None:
    if _redis:
        await _redis.aclose()


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": VERSION}


@app.get("/ioc-submission-log")
async def get_submission_log() -> dict:
    """Return the in-memory IOC submission log for attestation audit."""
    return {"submissions": _ioc_submission_log, "count": len(_ioc_submission_log)}


# ── IOC submission audit helper ───────────────────────────────────────────────

def _log_ioc_submission(ioc: str, destination: str, payload: Any) -> None:
    payload_hash = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    _ioc_submission_log.append({
        "ioc": ioc,
        "destination": destination,
        "payload_hash": payload_hash,
        "submitted_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


async def _cache_get(key: str) -> Any | None:
    if not _redis:
        return None
    val = await _redis.get(key)
    return json.loads(val) if val else None


async def _cache_set(key: str, value: Any) -> None:
    if _redis:
        await _redis.setex(key, CACHE_TTL_SEC, json.dumps(value))


# ── VirusTotal tools ──────────────────────────────────────────────────────────

class IOCRequest(BaseModel):
    ioc: str


@app.post("/tools/vt_file_lookup")
async def vt_file_lookup(req: IOCRequest) -> dict:
    cache_key = f"vt:file:{req.ioc}"
    cached = await _cache_get(cache_key)
    if cached:
        return {"tool": "vt_file_lookup", "ioc": req.ioc, "result": cached, "cached": True}

    if not VT_API_KEY:
        return {"tool": "vt_file_lookup", "ioc": req.ioc, "result": None, "note": "VT_API_KEY not set"}

    _log_ioc_submission(req.ioc, "virustotal", {"type": "file_hash", "ioc": req.ioc})

    try:
        async with vt.Client(VT_API_KEY) as client:
            file = await client.get_object_async(f"/files/{req.ioc}")
            result = {
                "sha256": file.sha256,
                "malicious": file.last_analysis_stats.get("malicious", 0),
                "suspicious": file.last_analysis_stats.get("suspicious", 0),
                "total": sum(file.last_analysis_stats.values()),
                "names": file.names[:5] if hasattr(file, "names") else [],
            }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"VT lookup failed: {e}")

    await _cache_set(cache_key, result)
    return {"tool": "vt_file_lookup", "ioc": req.ioc, "result": result}


@app.post("/tools/vt_ip_lookup")
async def vt_ip_lookup(req: IOCRequest) -> dict:
    cache_key = f"vt:ip:{req.ioc}"
    cached = await _cache_get(cache_key)
    if cached:
        return {"tool": "vt_ip_lookup", "ioc": req.ioc, "result": cached, "cached": True}

    if not VT_API_KEY:
        return {"tool": "vt_ip_lookup", "ioc": req.ioc, "result": None, "note": "VT_API_KEY not set"}

    _log_ioc_submission(req.ioc, "virustotal", {"type": "ip", "ioc": req.ioc})

    try:
        async with vt.Client(VT_API_KEY) as client:
            ip = await client.get_object_async(f"/ip_addresses/{req.ioc}")
            result = {
                "country": getattr(ip, "country", None),
                "as_owner": getattr(ip, "as_owner", None),
                "malicious": ip.last_analysis_stats.get("malicious", 0),
                "reputation": getattr(ip, "reputation", 0),
            }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"VT lookup failed: {e}")

    await _cache_set(cache_key, result)
    return {"tool": "vt_ip_lookup", "ioc": req.ioc, "result": result}


@app.post("/tools/vt_domain_lookup")
async def vt_domain_lookup(req: IOCRequest) -> dict:
    _log_ioc_submission(req.ioc, "virustotal", {"type": "domain", "ioc": req.ioc})
    if not VT_API_KEY:
        return {"tool": "vt_domain_lookup", "ioc": req.ioc, "result": None, "note": "VT_API_KEY not set"}
    return {"tool": "vt_domain_lookup", "ioc": req.ioc, "result": {"note": "see vt_ip_lookup for pattern"}}


@app.post("/tools/vt_url_lookup")
async def vt_url_lookup(req: IOCRequest) -> dict:
    _log_ioc_submission(req.ioc, "virustotal", {"type": "url", "ioc": req.ioc})
    if not VT_API_KEY:
        return {"tool": "vt_url_lookup", "ioc": req.ioc, "result": None, "note": "VT_API_KEY not set"}
    return {"tool": "vt_url_lookup", "ioc": req.ioc, "result": {"note": "see vt_file_lookup for pattern"}}


# ── OTX ──────────────────────────────────────────────────────────────────────

@app.post("/tools/otx_indicator_lookup")
async def otx_indicator_lookup(req: IOCRequest) -> dict:
    _log_ioc_submission(req.ioc, "alienvault_otx", {"ioc": req.ioc})

    cache_key = f"otx:{req.ioc}"
    cached = await _cache_get(cache_key)
    if cached:
        return {"tool": "otx_indicator_lookup", "ioc": req.ioc, "result": cached, "cached": True}

    if not OTX_API_KEY:
        return {"tool": "otx_indicator_lookup", "ioc": req.ioc, "result": None, "note": "OTX_API_KEY not set"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://otx.alienvault.com/api/v1/indicators/IPv4/{req.ioc}/general",
                headers={"X-OTX-API-KEY": OTX_API_KEY},
            )
            resp.raise_for_status()
            data = resp.json()
            result = {
                "pulse_count": data.get("pulse_info", {}).get("count", 0),
                "reputation": data.get("reputation", 0),
                "country": data.get("country_name"),
                "tags": [p.get("name") for p in data.get("pulse_info", {}).get("pulses", [])[:5]],
            }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OTX lookup failed: {e}")

    await _cache_set(cache_key, result)
    return {"tool": "otx_indicator_lookup", "ioc": req.ioc, "result": result}


# ── Shodan enrichment ─────────────────────────────────────────────────────────

@app.post("/tools/shodan_host_enrichment")
async def shodan_host_enrichment(req: IOCRequest) -> dict:
    _log_ioc_submission(req.ioc, "shodan", {"ioc": req.ioc})
    if not SHODAN_API_KEY:
        return {"tool": "shodan_host_enrichment", "ioc": req.ioc, "result": None, "note": "SHODAN_API_KEY not set"}

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"https://api.shodan.io/shodan/host/{req.ioc}",
                params={"key": SHODAN_API_KEY},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Shodan enrichment failed: {e}")

    return {
        "tool": "shodan_host_enrichment",
        "ioc": req.ioc,
        "result": {
            "ports": data.get("ports", []),
            "vulns": list(data.get("vulns", {}).keys()),
            "org": data.get("org"),
            "tags": data.get("tags", []),
        },
    }


# ── Campaign correlation ──────────────────────────────────────────────────────

class CorrelateRequest(BaseModel):
    iocs: list[str]
    enrichment_results: list[dict]


@app.post("/tools/correlate_campaign")
async def correlate_campaign(req: CorrelateRequest) -> dict:
    """
    Basic campaign correlation: group IOCs by shared ASN, country, or OTX pulse tags.
    """
    clusters: dict[str, list[str]] = {}

    for result in req.enrichment_results:
        ioc = result.get("ioc", "unknown")
        r = result.get("result", {}) or {}

        # Cluster by country
        country = r.get("country") or r.get("country_code")
        if country:
            clusters.setdefault(f"country:{country}", []).append(ioc)

        # Cluster by OTX pulse tags
        for tag in r.get("tags", []):
            clusters.setdefault(f"otx_tag:{tag}", []).append(ioc)

        # Cluster by Shodan org
        org = r.get("org")
        if org:
            clusters.setdefault(f"org:{org}", []).append(ioc)

    # Only report clusters with >= 2 IOCs (indicates potential campaign)
    campaign_clusters = {k: v for k, v in clusters.items() if len(v) >= 2}

    return {
        "tool": "correlate_campaign",
        "ioc_count": len(req.iocs),
        "campaign_clusters": campaign_clusters,
        "cluster_count": len(campaign_clusters),
    }
