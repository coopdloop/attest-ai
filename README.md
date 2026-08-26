<div align="center">

```
 █████╗ ████████╗████████╗███████╗███████╗████████╗       █████╗ ██╗
██╔══██╗╚══██╔══╝╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝      ██╔══██╗██║
███████║   ██║      ██║   █████╗  ███████╗   ██║   █████╗███████║██║
██╔══██║   ██║      ██║   ██╔══╝  ╚════██║   ██║   ╚════╝██╔══██║██║
██║  ██║   ██║      ██║   ███████╗███████║   ██║         ██║  ██║██║
╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚══════╝   ╚═╝         ╚═╝  ╚═╝╚═╝
```

**Every thought, tool call, and decision — signed, timestamped, and yours to verify.**

[![Go](https://img.shields.io/badge/Go-1.22-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white)](https://python.org)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)](https://nextjs.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](https://docker.com)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible-412991?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/docs/api-reference)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

attest-ai is a **glass-box agent gateway** built for security teams adopting agentic AI. Every session — reasoning steps, tool calls, model choices, retries — is captured in a **cryptographically signed, hash-chained trace** that anyone downstream can verify independently.

It ships with a polished chat UI, an OpenAI-compatible API, three cyber-native agent harnesses, and a full attestation pipeline. Drop it in front of any LLM and get an auditable record of everything it did.

<div align="center">

```
┌──────────────────────────────────────────────────────────────────┐
│                        attest-ai stack                           │
│                                                                  │
│  ┌─────────────────┐    ┌──────────────────────────────────┐    │
│  │   Chat UI        │    │  Any OpenAI-compatible client    │    │
│  │  (Next.js :3000) │    │  (pi, LangChain, curl, ...)      │    │
│  └────────┬─────────┘    └──────────────┬───────────────────┘    │
│           │                             │                        │
│           └──────────┬──────────────────┘                        │
│                      ▼                                           │
│           ┌──────────────────────┐                               │
│           │    API Gateway :8080  │  ← auth, rate-limit, proxy   │
│           └──────────┬───────────┘                               │
│                      │                                           │
│         ┌────────────┼─────────────┐                             │
│         ▼            ▼             ▼                             │
│  ┌────────────┐ ┌─────────┐ ┌──────────────┐                    │
│  │ Orchestrator│ │  Auth   │ │  Attestation │                    │
│  │  :8000      │ │  :8081  │ │   :8082      │                    │
│  │  LiteLLM   │ │  JWT +  │ │  hash-chain  │                    │
│  │  MCP tools │ │  API key│ │  + signing   │                    │
│  └─────┬──────┘ └─────────┘ └──────────────┘                    │
│        │                                                         │
│        ▼                                                         │
│  ┌─────────────────────────────────────────────────┐            │
│  │              OpenRouter (400+ models)            │            │
│  └─────────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────────┘
```

</div>

## Features

- 🔐 **Cryptographic attestation** — Ed25519-signed, Merkle-style hash-chained trace per session. Export a bundle anyone can verify offline.
- 🪟 **Glass-box chat** — real-time streaming UI with per-message token stats, cost, latency, context %, and a reasoning toggle for thinking models
- 🤖 **400+ models via OpenRouter** — one API key, every model. Free tier models included.
- 🔌 **OpenAI-compatible API** — any framework that accepts a `base_url` override works: LangChain, CrewAI, pi, curl, the OpenAI SDK
- 🛠️ **Cyber-native harnesses** — three pre-built agent harnesses wired to MCP tool servers: Recon, Threat Intel Enrichment, and AI Red-Team
- 🏢 **Multi-tenant auth** — org-scoped JWT + `atai_` API keys, bcrypt-verified, revocable from the Admin UI
- 📋 **Trace browser** — browse, filter, and export every session's attestation bundle from the UI
- 🐳 **One-command deploy** — full stack via Docker Compose; works local or in a VPC

## Services

| Service | Port | Stack | Role |
|---------|------|-------|------|
| `api_gateway` | 8080 | Go / gin | Auth, rate-limit, OpenAI-compatible proxy |
| `auth_service` | 8081 | Go / gin | JWT issue, API key management, orgs/users |
| `attestation_service` | 8082 | Go / gin | Hash-chain trace storage, bundle export |
| `signing_service` | 8083 | Go / gRPC | Ed25519 key management, signing |
| `trace_query_service` | 8084 | Go / gin | Trace search, replay, bundle retrieval |
| `agent_orchestrator` | 8000 | Python / FastAPI | LiteLLM routing, tool-call loop, streaming |
| `context_library` | 8001 | Python / FastAPI | Harness/prompt config store |
| `recon_agent_tools` | 8100 | Python / MCP | Network recon tool server |
| `threat_intel_agent_tools` | 8101 | Python / MCP | Threat intel enrichment tools |
| `redteam_agent_tools` | 8102 | Python / MCP | AI red-team payload library |
| `frontend` | 3000 | Next.js 15 | Chat UI, trace browser, admin panel |

## Quick start

**Prerequisites:** Docker + Docker Compose, an [OpenRouter](https://openrouter.ai) API key.

```bash
git clone https://github.com/coopdloop/attest-ai.git
cd attest-ai

# Add your OpenRouter key
echo "OPENROUTER_API_KEY=sk-or-v1-..." > infra/.env

# Start everything
cd infra && docker compose up -d
```

| | URL |
|--|-----|
| Chat UI | http://localhost:3000 |
| API (OpenAI-compatible) | http://localhost:8080/v1 |

Open the UI → **Register** → **Admin → API Keys** → create a key → use it anywhere:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer atai_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/anthropic/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

See **[docs/quickstart.md](docs/quickstart.md)** for framework-specific examples (LangChain, CrewAI, pi, OpenAI SDK).

## Using with agentic frameworks

attest-ai speaks the OpenAI chat completions protocol. Set `base_url` to `http://localhost:8080/v1` and your `atai_` key as the Bearer token — that's it.

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="atai_your_key",
)

response = client.chat.completions.create(
    model="openrouter/anthropic/claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Run a recon scan on example.com"}],
)
```

Every call produces a signed trace viewable at http://localhost:3000/traces.

## Model selection

Prefix any [OpenRouter model ID](https://openrouter.ai/models) with `openrouter/`:

```
openrouter/anthropic/claude-sonnet-4-6      # Claude Sonnet
openrouter/google/gemini-2.5-pro            # Gemini 2.5 Pro
openrouter/nvidia/nemotron-3-super-120b-a12b:free   # free
openrouter/meta-llama/llama-3.1-8b-instruct:free    # free
```

### Smoke-test available models

```bash
# See which free models are currently responding
python3 scripts/test-models.py --api-key atai_...

# Sync verified working models into pi's model list
python3 scripts/sync-pi-models.py --api-key atai_... --free-only --verified
```

## What's in a trace

Every request through attest-ai returns a `_meta` field alongside the standard OpenAI response:

```json
{
  "choices": [{ "message": { "role": "assistant", "content": "..." } }],
  "_meta": {
    "session_id": "550e8400-e29b-41d4-a716-446655440000",
    "latency_ms": 1240,
    "cost_usd": 0.00042,
    "attestation_ids": ["abc123...", "def456..."]
  }
}
```

Retrieve and verify the full trace:

```bash
curl http://localhost:8084/traces/550e8400-e29b-41d4-a716-446655440000/bundle
```

## Project background

Built as a hobby project exploring what a **verifiable AI agent layer** looks like for security practitioners — somewhere between an observability platform and a compliance tool. The goal is to make "what did the AI actually do?" a question with a cryptographic answer, not just logs.

Spec and architecture generated with [theorycraft](https://github.com/coopdloop/theorycraft) → [product spec](https://github.com/coopdloop/a-open-webui-like-running-application-wh-spec).

---

<div align="center">

Built with Go · Python · Next.js · LiteLLM · OpenRouter · Docker

</div>
