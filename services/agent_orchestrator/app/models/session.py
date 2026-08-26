from __future__ import annotations
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class SessionMode(str, Enum):
    human = "human"
    machine = "machine"


class SessionStatus(str, Enum):
    active = "active"
    completed = "completed"
    failed = "failed"
    aborted = "aborted"


class CreateSessionRequest(BaseModel):
    agent_id: str
    mode: SessionMode = SessionMode.human
    org_id: str | None = None


class SessionResponse(BaseModel):
    session_id: str
    agent_id: str
    mode: SessionMode
    status: SessionStatus
    started_at: datetime


class SubmitTurnRequest(BaseModel):
    message: str
    stream: bool = False


class TurnResponse(BaseModel):
    turn_id: str
    response: str
    attestation_entry_ids: list[str] = Field(default_factory=list)


class TraceEvent(BaseModel):
    """Event emitted to attestation_service during agent execution."""
    session_id: str
    org_id: str
    event_type: str  # reasoning_step | tool_call | tool_response | model_swap | retry | completion | error
    payload: dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
