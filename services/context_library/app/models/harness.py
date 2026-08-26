from __future__ import annotations
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class ToolBinding(BaseModel):
    server: str
    tools: list[str]


class ModelBinding(BaseModel):
    primary: str
    fallback: str | None = None


class AttestationPolicy(BaseModel):
    sign_fields: list[str] = Field(default_factory=list)
    retain_fields: list[str] = Field(default_factory=list)
    redact_fields: list[str] = Field(default_factory=list)


class ROEScope(BaseModel):
    allow_active_scanning: bool = False
    allow_zone_transfer: bool = False
    max_subdomains_per_run: int = 500
    rate_limit_rps: int = 5
    extra: dict[str, Any] = Field(default_factory=dict)


class Guardrail(BaseModel):
    id: str
    description: str
    action: str  # block | warn | throttle | require | require_log


class HarnessDefinition(BaseModel):
    """Full harness definition — the structured form of a harness YAML."""
    name: str
    slug: str
    description: str | None = None
    version: str = "0.1.0"
    is_built_in: bool = False
    system_context: str = ""
    roe_scope: ROEScope = Field(default_factory=ROEScope)
    guardrails: list[Guardrail] = Field(default_factory=list)
    tool_bindings: list[ToolBinding] = Field(default_factory=list)
    model_bindings: ModelBinding = Field(default_factory=lambda: ModelBinding(primary="claude-sonnet-4-6"))
    attestation_policy: AttestationPolicy = Field(default_factory=AttestationPolicy)


class HarnessRecord(BaseModel):
    """Database row representation of a harness."""
    id: UUID = Field(default_factory=uuid4)
    org_id: UUID
    name: str
    slug: str
    description: str | None = None
    version: str = "0.1.0"
    is_built_in: bool = False
    git_sha: str | None = None
    config_path: str = ""
    attestation_policy: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class HarnessCreateRequest(BaseModel):
    name: str
    slug: str | None = None
    description: str | None = None
    definition: HarnessDefinition


class HarnessUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    definition: HarnessDefinition | None = None
