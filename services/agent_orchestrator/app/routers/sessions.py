"""
Sessions router — implements the four spec routes:
  POST   /sessions
  GET    /sessions/{session_id}
  POST   /sessions/{session_id}/turns
"""

from __future__ import annotations

import uuid
from datetime import datetime

import asyncpg
from app.models.session import (
    CreateSessionRequest,
    SessionMode,
    SessionResponse,
    SessionStatus,
    SubmitTurnRequest,
    TurnResponse,
)
from fastapi import APIRouter, Depends, HTTPException, Request, status

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.db_pool


def _get_executor(request: Request):
    return request.app.state.executor


@router.post("", status_code=status.HTTP_201_CREATED, response_model=SessionResponse)
async def create_session(
    req: CreateSessionRequest,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> SessionResponse:
    session_id = str(uuid.uuid4())
    org_id = req.org_id or "00000000-0000-0000-0000-000000000001"  # default org for single-user
    now = datetime.utcnow()

    try:
        await pool.execute(
            """INSERT INTO sessions (id, org_id, agent_id, mode, status, started_at)
               VALUES ($1, $2, $3, $4, 'active', $5)""",
            uuid.UUID(session_id),
            uuid.UUID(org_id),
            uuid.UUID(req.agent_id),
            req.mode.value,
            now,
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create session: {e}")

    return SessionResponse(
        session_id=session_id,
        agent_id=req.agent_id,
        mode=req.mode,
        status=SessionStatus.active,
        started_at=now,
    )


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    pool: asyncpg.Pool = Depends(_get_pool),
) -> dict:
    row = await pool.fetchrow(
        "SELECT id, agent_id, mode, status, started_at, completed_at FROM sessions WHERE id = $1",
        uuid.UUID(session_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="session not found")

    return {
        "session_id": str(row["id"]),
        "agent_id": str(row["agent_id"]),
        "mode": row["mode"],
        "status": row["status"],
        "started_at": row["started_at"].isoformat(),
        "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
    }


@router.post("/{session_id}/turns", status_code=status.HTTP_201_CREATED)
async def submit_turn(
    session_id: str,
    req: SubmitTurnRequest,
    pool: asyncpg.Pool = Depends(_get_pool),
    request: Request = None,
) -> TurnResponse:
    # Verify session exists
    row = await pool.fetchrow(
        "SELECT id, agent_id, mode, org_id FROM sessions WHERE id = $1 AND status = 'active'",
        uuid.UUID(session_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="session not found or not active")

    agent_id = str(row["agent_id"])
    org_id = str(row["org_id"])

    # Get next turn index
    turn_index = await pool.fetchval(
        "SELECT COALESCE(MAX(turn_index) + 1, 0) FROM turns WHERE session_id = $1",
        uuid.UUID(session_id),
    ) or 0

    turn_id = str(uuid.uuid4())

    # Insert turn (pending)
    await pool.execute(
        """INSERT INTO turns (id, session_id, org_id, turn_index, user_message, status)
           VALUES ($1, $2, $3, $4, $5, 'streaming')""",
        uuid.UUID(turn_id),
        uuid.UUID(session_id),
        uuid.UUID(org_id),
        turn_index,
        req.message,
    )

    # Fetch agent config to determine harness + model
    agent_row = await pool.fetchrow(
        "SELECT default_model, harness_id FROM agent_configs WHERE id = $1",
        uuid.UUID(agent_id),
    )
    model = agent_row["default_model"] if agent_row else "claude-sonnet-4-6"
    harness_id = str(agent_row["harness_id"]) if agent_row and agent_row["harness_id"] else None

    harness_slug = "general"
    if harness_id:
        h_row = await pool.fetchrow("SELECT slug FROM harnesses WHERE id = $1", uuid.UUID(harness_id))
        if h_row:
            harness_slug = h_row["slug"]

    # Build message history for this session
    history_rows = await pool.fetch(
        "SELECT user_message, agent_response FROM turns WHERE session_id = $1 AND status = 'completed' ORDER BY turn_index",
        uuid.UUID(session_id),
    )
    messages = []
    for hr in history_rows:
        messages.append({"role": "user", "content": hr["user_message"]})
        if hr["agent_response"]:
            messages.append({"role": "assistant", "content": hr["agent_response"]})
    messages.append({"role": "user", "content": req.message})

    # Run agent
    executor = request.app.state.executor
    response_text, attest_ids = await executor.run(
        session_id=session_id,
        org_id=org_id,
        agent_id=agent_id,
        harness_slug=harness_slug,
        model=model,
        messages=messages,
    )

    # Update turn as completed
    await pool.execute(
        "UPDATE turns SET agent_response = $1, status = 'completed', completed_at = now() WHERE id = $2",
        response_text,
        uuid.UUID(turn_id),
    )

    return TurnResponse(
        turn_id=turn_id,
        response=response_text,
        attestation_entry_ids=attest_ids,
    )
