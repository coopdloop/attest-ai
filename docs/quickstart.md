# attest-ai — Quickstart

attest-ai is a glass-box agent gateway. Every LLM call goes through a cryptographically attested
trace, and the API is OpenAI-compatible — so any framework that accepts a `base_url` override works
out of the box.

---

## 1. Prerequisites

- Docker + Docker Compose
- An [OpenRouter](https://openrouter.ai) API key (gives access to every model through one key)

---

## 2. Start the stack

```bash
git clone <repo>
cd attest-ai

# Copy the example env and fill in your OpenRouter key
cp infra/.env.example infra/.env   # or edit infra/.env directly
#   OPENROUTER_API_KEY=sk-or-v1-...

cd infra
docker compose up -d
```

Services come up on:

| Service | URL |
|---|---|
| Frontend UI | http://localhost:3000 |
| API gateway (OpenAI-compatible) | http://localhost:8080 |
| Auth service | http://localhost:8081 |

---

## 3. Create your account

Open http://localhost:3000 → click **Register** → fill in your email, password, and workspace name.

---

## 4. Generate an API key

1. Log in and click **Admin** in the left sidebar (or go to http://localhost:3000/admin)
2. Click the **API Keys** tab
3. Enter a name (e.g. `my-agent`) and click **Create**
4. **Copy the key immediately** — it starts with `atai_` and is shown only once

---

## 5. Use from an agentic framework

The gateway speaks the OpenAI chat completions protocol. Point your framework at
`http://localhost:8080/v1` and use your `atai_` key as the Bearer token.

### OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="atai_your_key_here",
)

response = client.chat.completions.create(
    model="openrouter/anthropic/claude-sonnet-4-6",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### LangChain

```python
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="http://localhost:8080/v1",
    api_key="atai_your_key_here",
    model="openrouter/anthropic/claude-sonnet-4-6",
)

response = llm.invoke("Hello!")
print(response.content)
```

### CrewAI

```python
from crewai import LLM

llm = LLM(
    model="openai/openrouter/anthropic/claude-sonnet-4-6",  # crewai prefixes "openai/"
    base_url="http://localhost:8080/v1",
    api_key="atai_your_key_here",
)
```

### curl

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer atai_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/anthropic/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## 6. Selecting a model

Prefix any [OpenRouter model ID](https://openrouter.ai/models) with `openrouter/`:

```
openrouter/anthropic/claude-sonnet-4-6
openrouter/openai/gpt-4o
openrouter/google/gemini-2.5-pro
openrouter/nvidia/llama-3.1-nemotron-70b-instruct:free
openrouter/ox-alpha          # default
```

Browse all available models at https://openrouter.ai/models — copy the Model ID and prepend `openrouter/`.

---

## 7. Using with pi (the agentic framework)

pi uses a file-based provider + credentials system. Add attest-ai as a custom provider so all pi
requests route through the gateway and are attested.

### 7a. Create `~/.pi/agent/models.json`

This is the file pi reads for user-defined providers. Create it (or add to it if it already exists):

```json
{
  "providers": {
  "attest-ai": {
    "models": [
      {
        "id": "openrouter/anthropic/claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6 (via attest-ai)",
        "api": "openai-completions",
        "baseUrl": "http://localhost:8080/v1",
        "provider": "attest-ai",
        "reasoning": false,
        "input": ["text", "image"],
        "cost": { "input": 3, "output": 15, "cacheRead": 0.3, "cacheWrite": 3.75 },
        "contextWindow": 200000,
        "maxTokens": 64000,
        "compat": { "supportsDeveloperRole": false }
      }
    ]
  }
  }
}
```

The `"id"` is the model string sent to attest-ai's gateway; add as many entries as you want.
Any `openrouter/<provider>/<model>` id works — the gateway forwards to OpenRouter.

### 7b. Add the API key in `~/.pi/agent/auth.json`

```json
{
  "attest-ai": {
    "type": "api_key",
    "key": "atai_your_key_here"
  }
}
```

### 7c. Set as default in `~/.pi/agent/settings.json`

```json
{
  "defaultProvider": "attest-ai",
  "defaultModel": "openrouter/anthropic/claude-sonnet-4-6"
}
```

After this, running `pi` will route through attest-ai and every session will appear in the
Traces view at http://localhost:3000/traces.

To switch models for a single run, pass `--model openrouter/google/gemini-2.5-pro` (or whichever
model id you added to models-store.json). Free models (`:free` suffix) are good for development:

```
openrouter/nvidia/llama-3.1-nemotron-70b-instruct:free
openrouter/meta-llama/llama-3.1-8b-instruct:free
openrouter/google/gemini-2.0-flash-exp:free
```

---

## 8. What you get

Every request through attest-ai is:

- **Traced** — each reasoning step, tool call, and completion stored in a hash-linked chain
- **Attested** — the trace is cryptographically signed with an org-scoped Ed25519 key
- **Auditable** — browse sessions at http://localhost:3000/traces, export signed bundles

The response includes a `_meta` field with session ID, latency, cost, and attestation entry IDs
that you can use to retrieve the full trace later.

```json
{
  "choices": [...],
  "usage": {...},
  "_meta": {
    "session_id": "550e8400-...",
    "latency_ms": 1240,
    "cost_usd": 0.00042,
    "attestation_ids": ["abc123...", "def456..."]
  }
}
```

Retrieve the trace:

```bash
curl http://localhost:8084/traces/550e8400-...
```
