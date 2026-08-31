from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

import yaml
from app.db.database import get_conn
from app.models.harness import (
    HarnessCreateRequest,
    HarnessDefinition,
    HarnessRecord,
    HarnessUpdateRequest,
)
from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/harnesses", tags=["harnesses"])

GIT_REPO_PATH = os.getenv("GIT_REPO_PATH", "/data/harness-configs")


def _definition_to_yaml(definition: HarnessDefinition) -> str:
    return yaml.dump(definition.model_dump(), default_flow_style=False, allow_unicode=True)


def _save_to_git(slug: str, definition: HarnessDefinition) -> tuple[str, str]:
    """Write harness YAML to the git-backed directory. Returns (config_path, git_sha)."""
    repo_path = Path(GIT_REPO_PATH)
    repo_path.mkdir(parents=True, exist_ok=True)

    config_path = str(repo_path / f"{slug}.yaml")
    content = _definition_to_yaml(definition)
    Path(config_path).write_text(content, encoding="utf-8")

    # Git commit (best-effort; no-op if git not configured)
    git_sha = "none"
    try:
        import git
        try:
            repo = git.Repo(GIT_REPO_PATH)
        except git.InvalidGitRepositoryError:
            repo = git.Repo.init(GIT_REPO_PATH)
        repo.index.add([f"{slug}.yaml"])
        if repo.is_dirty(index=True):
            commit = repo.index.commit(f"update harness: {slug}")
            git_sha = commit.hexsha[:8]
    except Exception:
        pass

    return config_path, git_sha


@router.get("", response_model=list[dict])
async def list_harnesses(org_id: str) -> list[dict]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, name, slug, description, version, is_built_in, is_active, created_at "
            "FROM harnesses WHERE org_id = $1 AND is_active = true ORDER BY name",
            uuid.UUID(org_id),
        )
    return [dict(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_harness(org_id: str, req: HarnessCreateRequest) -> dict:
    slug = req.slug or req.name.lower().replace(" ", "-")
    config_path, git_sha = _save_to_git(slug, req.definition)

    harness_id = uuid.uuid4()
    async with get_conn() as conn:
        await conn.execute(
            """INSERT INTO harnesses
               (id, org_id, name, slug, description, version, config_path, git_sha,
                attestation_policy, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)""",
            harness_id,
            uuid.UUID(org_id),
            req.name,
            slug,
            req.definition.description,
            req.definition.version,
            config_path,
            git_sha,
            json.dumps(req.definition.attestation_policy.model_dump()),
        )
    return {"id": str(harness_id), "slug": slug, "config_path": config_path}


@router.get("/{harness_id}")
async def get_harness(org_id: str, harness_id: str) -> dict:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM harnesses WHERE id = $1 AND org_id = $2",
            uuid.UUID(harness_id),
            uuid.UUID(org_id),
        )
    if not row:
        raise HTTPException(status_code=404, detail="harness not found")

    # Read YAML from disk
    config_path = row["config_path"]
    definition: Any = {}
    if Path(config_path).exists():
        with open(config_path) as f:
            definition = yaml.safe_load(f)

    result = dict(row)
    result["definition"] = definition
    return result


@router.put("/{harness_id}")
async def update_harness(org_id: str, harness_id: str, req: HarnessUpdateRequest) -> dict:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT slug FROM harnesses WHERE id = $1 AND org_id = $2",
            uuid.UUID(harness_id),
            uuid.UUID(org_id),
        )
    if not row:
        raise HTTPException(status_code=404, detail="harness not found")

    updates: dict[str, Any] = {}
    if req.name is not None:
        updates["name"] = req.name
    if req.description is not None:
        updates["description"] = req.description
    if req.definition is not None:
        config_path, git_sha = _save_to_git(row["slug"], req.definition)
        updates["config_path"] = config_path
        updates["git_sha"] = git_sha
        updates["attestation_policy"] = json.dumps(req.definition.attestation_policy.model_dump())

    if updates:
        set_clause = ", ".join(f"{k} = ${i+3}" for i, k in enumerate(updates))
        values = list(updates.values())
        async with get_conn() as conn:
            await conn.execute(
                f"UPDATE harnesses SET {set_clause}, updated_at = now() WHERE id = $1 AND org_id = $2",
                uuid.UUID(harness_id),
                uuid.UUID(org_id),
                *values,
            )
    return {"id": harness_id, "updated": True}


@router.delete("/{harness_id}", status_code=status.HTTP_200_OK)
async def delete_harness(org_id: str, harness_id: str) -> dict:
    async with get_conn() as conn:
        result = await conn.execute(
            "UPDATE harnesses SET is_active = false, updated_at = now() WHERE id = $1 AND org_id = $2",
            uuid.UUID(harness_id),
            uuid.UUID(org_id),
        )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="harness not found")
    return {"deleted": True}


@router.get("/{harness_id}/export")
async def export_harness(org_id: str, harness_id: str) -> dict:
    """Export harness definition as YAML/JSON for Harness Studio import."""
    harness = await get_harness(org_id, harness_id)
    return {"harness": harness, "format": "yaml"}


@router.post("/import")
async def import_harness(org_id: str, body: dict) -> dict:
    """Import a harness definition from exported YAML/JSON."""
    definition_data = body.get("definition", {})
    definition = HarnessDefinition(**definition_data)
    req = HarnessCreateRequest(
        name=definition.name,
        slug=definition.slug,
        definition=definition,
    )
    return await create_harness(org_id, req)
