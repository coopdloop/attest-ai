import os
from contextlib import asynccontextmanager

import asyncpg
from fastapi import FastAPI

from app.agents.executor import AgentExecutor
from app.mcp.client import MCPClient
from app.routers import chat, sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    dsn = os.environ["DATABASE_URL"]
    attestation_url = os.environ["ATTESTATION_SERVICE_URL"]
    context_library_url = os.environ["CONTEXT_LIBRARY_URL"]
    mcp_registry_path = os.getenv("MCP_SERVER_REGISTRY_PATH", "/config/mcp_servers.yaml")
    litellm_config = os.getenv("LITELLM_CONFIG_PATH", "/config/litellm.yaml")

    pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    app.state.db_pool = pool

    mcp_client = MCPClient(mcp_registry_path)
    app.state.mcp_client = mcp_client

    executor = AgentExecutor(
        attestation_url=attestation_url,
        context_library_url=context_library_url,
        mcp_client=mcp_client,
        litellm_config_path=litellm_config,
        db_pool=pool,
    )
    app.state.executor = executor

    yield

    await pool.close()


app = FastAPI(title="agent_orchestrator", version="0.1.0", lifespan=lifespan)
app.include_router(sessions.router)
app.include_router(chat.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
