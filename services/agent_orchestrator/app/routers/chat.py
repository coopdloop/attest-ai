"""
OpenAI-compatible chat/completions and agent listing endpoints.

POST /chat/completions  — maps model → agent, creates session, runs turn
GET  /agents            — lists agent_configs for the org
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, field_validator

router = APIRouter(tags=["chat"])


def _get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


async def _persist_completion(
    pool: asyncpg.Pool,
    turn_id: str,
    session_id: str,
    response_text: str,
    meta: dict,
    usage: dict,
    model: str,
) -> None:
    """Persist per-turn economics + roll them up onto the session so the
    analytics dashboard can aggregate spend/latency/tokens without recompute."""
    cost = meta.get("cost_usd")
    latency = int(meta.get("latency_ms") or 0)
    total_tokens = int(usage.get("total_tokens") or 0)
    in_tok = int(usage.get("prompt_tokens") or 0)
    out_tok = int(usage.get("completion_tokens") or 0)

    await pool.execute(
        """UPDATE turns SET agent_response=$1, status='completed', completed_at=now(),
                  cost_usd=$2, latency_ms=$3, model_id=$4,
                  input_tokens=$5, output_tokens=$6
           WHERE id=$7""",
        response_text, cost, latency, model, in_tok, out_tok, uuid.UUID(turn_id),
    )
    await pool.execute(
        """UPDATE sessions SET status='completed', completed_at=now(),
                  model_id=$1,
                  total_cost_usd = total_cost_usd + $2,
                  total_tokens   = total_tokens + $3,
                  total_latency_ms = total_latency_ms + $4
           WHERE id=$5""",
        model, cost or 0.0, total_tokens, latency, uuid.UUID(session_id),
    )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: str
    content: str | list[Any] | None = None

    @field_validator("content", mode="before")
    @classmethod
    def coerce_content(cls, v: Any) -> str | list[Any] | None:
        # Some clients (e.g. pi) send content as a list of content blocks.
        # Flatten to plain text for our executor.
        if isinstance(v, list):
            parts = []
            for block in v:
                if isinstance(block, dict):
                    parts.append(block.get("text") or block.get("content") or "")
                elif isinstance(block, str):
                    parts.append(block)
            return " ".join(p for p in parts if p)
        return v


class ChatCompletionsRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float | None = None


# ---------------------------------------------------------------------------
# POST /chat/completions
# ---------------------------------------------------------------------------

@router.post("/chat/completions")
async def chat_completions(
    req: ChatCompletionsRequest,
    request: Request,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> dict:
    # Find an agent that matches the requested model, else use the first active one.
    agent_row = await pool.fetchrow(
        "SELECT id, org_id FROM agent_configs WHERE default_model = $1 LIMIT 1",
        req.model,
    )
    if not agent_row:
        agent_row = await pool.fetchrow("SELECT id, org_id FROM agent_configs LIMIT 1")
    if not agent_row:
        raise HTTPException(status_code=404, detail=f"no agent configured for model '{req.model}'")

    agent_id = str(agent_row["id"])
    org_id = request.headers.get("X-Org-Id") or str(agent_row.get("org_id", ""))
    if not org_id:
        raise HTTPException(status_code=400, detail="missing org context")
    session_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Caller type: API-key traffic is machine-driven, browser sessions are human.
    is_api_key = request.headers.get("X-Caller-Type") == "api_key"
    mode = "machine" if is_api_key else "human"
    # For api_key callers the gateway forwards the key's id as X-User-Id; attribute
    # the session to that key so Governance can roll up per-key spend.
    api_key_id = None
    if is_api_key:
        try:
            api_key_id = uuid.UUID(str(request.headers.get("X-User-Id") or ""))
        except ValueError:
            api_key_id = None

    # Create session
    await pool.execute(
        "INSERT INTO sessions (id, org_id, agent_id, mode, status, api_key_id, started_at) VALUES ($1,$2,$3,$4,'active',$5,$6)",
        uuid.UUID(session_id), uuid.UUID(org_id), uuid.UUID(agent_id), mode, api_key_id, now,
    )

    # Build turn index
    turn_id = str(uuid.uuid4())
    user_message = next(
        (m.content for m in reversed(req.messages) if m.role == "user"), ""
    )

    await pool.execute(
        "INSERT INTO turns (id, session_id, org_id, turn_index, user_message, status) VALUES ($1,$2,$3,0,$4,'streaming')",
        uuid.UUID(turn_id), uuid.UUID(session_id), uuid.UUID(org_id), user_message,
    )

    # Run agent
    executor = request.app.state.executor
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    agent_config = await pool.fetchrow(
        "SELECT default_model, harness_id FROM agent_configs WHERE id = $1", uuid.UUID(agent_id)
    )
    # Always use the model the caller requested; fall back to agent default only if none given
    model = req.model or (agent_config["default_model"] if agent_config else "openrouter/ox-alpha")
    harness_slug = "general"
    if agent_config and agent_config["harness_id"]:
        h = await pool.fetchrow("SELECT slug FROM harnesses WHERE id = $1", agent_config["harness_id"])
        if h:
            harness_slug = h["slug"]

    if req.stream:
        async def _stream_response():
            full_text   = ""
            final_meta: dict = {}

            async for sse_str in executor.run_streaming(
                session_id=session_id,
                org_id=org_id,
                agent_id=agent_id,
                harness_slug=harness_slug,
                model=model,
                messages=messages,
            ):
                # Capture meta event before forwarding
                if sse_str.startswith("event: meta\n"):
                    data_line = sse_str[len("event: meta\ndata: "):]
                    try:
                        final_meta = __import__("json").loads(data_line.strip())
                    except Exception:
                        pass
                elif sse_str.startswith("data: ") and not sse_str.startswith("data: [DONE]"):
                    try:
                        chunk_data = __import__("json").loads(sse_str[6:].strip())
                        content = (chunk_data.get("choices", [{}])[0].get("delta", {}).get("content") or "")
                        full_text += content
                    except Exception:
                        pass

                yield sse_str

            # Post-stream DB update (runs when generator is exhausted)
            try:
                usage = final_meta.get("usage", {}) or {}
                await _persist_completion(
                    pool, turn_id, session_id, full_text, final_meta, usage, model,
                )
            except Exception:
                pass

        return StreamingResponse(
            _stream_response(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    response_text, attestation_ids, meta = await executor.run(
        session_id=session_id,
        org_id=org_id,
        agent_id=agent_id,
        harness_slug=harness_slug,
        model=model,
        messages=messages,
    )

    usage = meta.get("usage", {})
    try:
        await _persist_completion(pool, turn_id, session_id, response_text, meta, usage, model)
    except Exception:
        pass

    return {
        "id": f"chatcmpl-{session_id}",
        "object": "chat.completion",
        "created": int(now.timestamp()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response_text,
                    **({"reasoning_content": meta["reasoning"]} if meta.get("reasoning") else {}),
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens":     usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens":      usage.get("total_tokens", 0),
        },
        "_meta": {
            "session_id":        session_id,
            "latency_ms":        meta.get("latency_ms", 0),
            "cost_usd":          meta.get("cost_usd"),
            "iterations":        meta.get("iterations", 1),
            "attestation_ids":   attestation_ids,
            "reasoning":         meta.get("reasoning"),
        },
    }


# ---------------------------------------------------------------------------
# GET /models — proxy OpenRouter model catalog, prefixing IDs with openrouter/
# ---------------------------------------------------------------------------

@router.get("/models")
async def list_models(request: Request) -> dict:
    import os

    import httpx
    key = os.getenv("OPENROUTER_API_KEY", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {key}"} if key else {},
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])
    except Exception as e:
        return {"object": "list", "data": [], "error": str(e)}

    models = []
    for m in data:
        raw_id = m.get("id", "")
        models.append({
            "id": f"openrouter/{raw_id}",
            "object": "model",
            "owned_by": raw_id.split("/")[0] if "/" in raw_id else "openrouter",
            "context_length": m.get("context_length"),
            "pricing": m.get("pricing", {}),
            "name": m.get("name", raw_id),
            "description": m.get("description", ""),
        })

    return {"object": "list", "data": models}


# ---------------------------------------------------------------------------
# GET /agents
# ---------------------------------------------------------------------------

@router.get("/agents")
async def list_agents(
    request: Request,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> list[dict]:
    rows = await pool.fetch(
        """SELECT ac.id, ac.name, ac.description, ac.default_model, h.slug as harness_slug
           FROM agent_configs ac
           LEFT JOIN harnesses h ON h.id = ac.harness_id
           ORDER BY ac.created_at DESC"""
    )
    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "description": r["description"] or "",
            "model": r["default_model"],
            "harness": r["harness_slug"],
        }
        for r in rows
    ]
