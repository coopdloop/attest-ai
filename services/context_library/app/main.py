import os
from contextlib import asynccontextmanager

from app.db.database import close_pool, init_pool
from app.routers import harnesses
from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ["DATABASE_URL"]
    await init_pool(dsn)
    # Seed built-in harnesses on startup
    await _seed_built_in_harnesses()
    yield
    await close_pool()


VERSION = os.getenv("APP_VERSION", "0.1.0")

app = FastAPI(title="context_library", version=VERSION, lifespan=lifespan)
app.include_router(harnesses.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "version": VERSION}


async def _seed_built_in_harnesses() -> None:
    """Load pre-built harness YAMLs from /config/harnesses into the default org."""
    import glob
    import json
    import uuid
    from pathlib import Path

    import yaml
    from app.db.database import get_conn
    from app.models.harness import AttestationPolicy, HarnessDefinition

    harness_dir = os.getenv("BUILT_IN_HARNESS_DIR", "/config/harnesses")
    default_org_id = os.getenv("DEFAULT_ORG_ID", "00000000-0000-0000-0000-000000000001")

    for yaml_path in glob.glob(f"{harness_dir}/*.yaml"):
        try:
            with open(yaml_path) as f:
                data = yaml.safe_load(f)
            slug = Path(yaml_path).stem

            async with get_conn() as conn:
                exists = await conn.fetchval(
                    "SELECT 1 FROM harnesses WHERE slug = $1 AND is_built_in = true LIMIT 1", slug
                )
                if exists:
                    continue

                attest_policy = data.get("attestation_policy", {})
                await conn.execute(
                    """INSERT INTO harnesses
                       (id, org_id, name, slug, description, version, is_built_in,
                        config_path, attestation_policy)
                       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
                       ON CONFLICT (org_id, slug) DO NOTHING""",
                    uuid.uuid4(),
                    uuid.UUID(default_org_id),
                    data.get("name", slug),
                    slug,
                    data.get("description"),
                    data.get("version", "0.1.0"),
                    yaml_path,
                    json.dumps(attest_policy),
                )
        except Exception as e:
            import logging
            logging.warning(f"Failed to seed harness {yaml_path}: {e}")
