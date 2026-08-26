# attest-ai — Build Status

> Source of truth for implementation progress against `product.json`.
> Updated after every component milestone.

---

## Overall Progress

| # | Component | Status | Completion |
|---|-----------|--------|-----------|
| 1 | **Repo scaffolding** | ✅ Done | 100% |
| 2 | **Infra (docker-compose + migrations)** | ✅ Done | 100% |
| 3 | **signing_service** (Go/gRPC :8083) | ✅ Done | 100% |
| 4 | **auth_service** (Go/gin :8081) | ✅ Done | 100% |
| 5 | **attestation_service** (Go/gin :8082) | ✅ Done | 100% |
| 6 | **context_library** (Python/FastAPI :8001) | ✅ Done | 100% |
| 7 | **agent_orchestrator** (Python/FastAPI :8000) | ✅ Done | 100% |
| 8 | **recon_agent_tools** (Python/MCP :8100) | ✅ Done | 100% |
| 9 | **threat_intel_agent_tools** (Python/MCP :8101) | ✅ Done | 100% |
| 10 | **redteam_agent_tools** (Python/MCP :8102) | ✅ Done | 100% |
| 11 | **api_gateway** (Go/gin :8080) | ✅ Done | 100% |
| 12 | **trace_query_service** (Go/gin :8084) | ✅ Done | 100% |
| 13 | **frontend** (React/Next.js) | ✅ Done | 100% |

**Total: 13/13 components complete — 100%**

---

## 1. Repo Scaffolding ✅

- [x] Monorepo directory tree (`services/`, `infra/`, `config/`, `frontend/`)
- [x] `.gitignore` (Go, Python, Node, secrets, keys)
- [x] `BUILD_STATUS.md`
- [x] Root `README.md`

---

## 2. Infra ✅

### docker-compose
- [x] `infra/docker-compose.yml` — all 10 services + postgres, redis, minio; x-common-env + x-depends-infra anchors
- [x] `infra/docker-compose.dev.yml` — dev overrides (debug log level, SINGLE_USER_MODE, ollama on host.docker.internal)

### Database Migrations
- [x] `001_orgs.sql` — orgs + update_updated_at() trigger
- [x] `002_users.sql` — users (user_role enum), teams, team_members, refresh_tokens
- [x] `003_api_keys.sql` — api_keys with bcrypt hash, key_prefix, scopes[]
- [x] `004_sessions.sql` — sessions (session_mode, session_status enums)
- [x] `005_turns.sql` — turns with UNIQUE(session_id, turn_index)
- [x] `006_hash_chain.sql` — trace_event_type enum, hash_chain_entries, attestation_bundles, signing_audit_log
- [x] `007_harnesses.sql` — harnesses with git_sha, is_built_in, attestation_policy JSONB
- [x] `008_agent_configs.sql` — agent_configs, agent_registry_permissions

---

## 3. signing_service ✅

- [x] `proto/signing.proto` — Sign, GetPublicKey, RotateKey RPCs
- [x] `internal/keystore/keystore.go` — LocalFileStore, Ed25519 keygen, keyID = SHA-256(pubkey) prefix
- [x] `internal/signer/signer.go` — Sign (ed25519.Sign + audit log), RotateKey
- [x] `internal/db/audit.go` — signing_audit_log INSERT
- [x] `cmd/server/main.go` — gRPC server, logging interceptor, EnsureOrgKey on startup
- [x] `cmd/server/handler.go` — all 3 RPC handlers
- [x] `Dockerfile` — multi-stage Go build, /keys volume, EXPOSE 8083

---

## 4. auth_service ✅

- [x] `internal/models/models.go` — Org, User, Team, APIKey, TokenClaims
- [x] `internal/auth/jwt.go` — RSA-256 JWT; access token 15 min, refresh 7 days
- [x] `internal/handlers/auth.go` — Register, Login, RefreshToken, IntrospectToken, OIDC/SAML stubs
- [x] `internal/handlers/orgs.go` — CRUD + GetAgentPermissions / UpdateAgentPermissions
- [x] `internal/handlers/users.go` — CRUD, soft-delete (is_active=false)
- [x] `internal/handlers/teams.go` — CRUD + member fetch
- [x] `internal/handlers/apikeys.go` — Create (atai_ prefix, bcrypt hash), Revoke
- [x] `internal/middleware/auth.go` — RequireAuth (introspect), RequireRole
- [x] `cmd/server/main.go` — 18 routes; admin group requires role=admin
- [x] `Dockerfile`

---

## 5. attestation_service ✅

- [x] `internal/chain/chain.go` — HashPayload, HashChain, VerifyChain, genesisHash
- [x] `internal/store/minio.go` — ObjectStore, TraceEventKey, BundleKey
- [x] `internal/handlers/attestation.go` — AppendEvent (atomic seq, hash, blob), FinalizeSession (gRPC sign), GetBundle
- [x] `internal/signclient/client.go` — insecure gRPC client to signing_service
- [x] `cmd/server/main.go` — 3 routes
- [x] `Dockerfile`

---

## 6. context_library ✅

- [x] `app/models/harness.py` — HarnessDefinition, AttestationPolicy, ROEScope, Guardrail (Pydantic v2)
- [x] `app/db/database.py` — asyncpg pool, get_conn() context manager
- [x] `app/routers/harnesses.py` — CRUD + _save_to_git() + export/import endpoints
- [x] `app/main.py` — startup seed of 3 built-in harnesses from /config/harnesses/*.yaml
- [x] `Dockerfile`

---

## 7. agent_orchestrator ✅

- [x] `app/mcp/client.py` — MCPClient, mcp_servers.yaml loading, env-var URL expansion, call_tool
- [x] `app/agents/executor.py` — ReAct loop; {server}__{tool} naming; _emit_trace (non-blocking); error trace events
- [x] `app/routers/sessions.py` — submit_turn: harness lookup, full message history, executor.run(), status update
- [x] `app/main.py` — asyncpg + MCPClient + AgentExecutor lifespan init
- [x] `Dockerfile`

---

## 8. recon_agent_tools ✅

- [x] `app/main.py` — _in_scope (RFC1918 denylist + allowlist), enumerate_subdomains (dns.resolver), shodan_host_lookup (sanitized response), passive_dns_history (stub)
- [x] `Dockerfile`

---

## 9. threat_intel_agent_tools ✅

- [x] `app/main.py` — _log_ioc_submission (SHA-256 audit), Redis caching (3600s TTL), vt_file_lookup (async vt.Client), otx_indicator_lookup, shodan_host_context, correlate_campaign (cluster ≥2 IOCs), GET /ioc-submission-log
- [x] `Dockerfile`

---

## 10. redteam_agent_tools ✅

- [x] `app/main.py` — MutationStrategy enum (5 strategies), _score_response (refusal detection), run_prompt_injection_suite, run_jailbreak_suite (full transcripts), generate_report (critical/high/medium severity)
- [x] `Dockerfile`

---

## 11. api_gateway ✅

- [x] `internal/ratelimit/limiter.go` — Redis sliding window INCR+EXPIRE; per-org/per-key; key format ratelimit:org:{orgID}:{window_unix}
- [x] `internal/middleware/auth.go` — POST to auth_service /tokens/introspect; sets gin context user_id/org_id/roles
- [x] `internal/handlers/gateway.go` — ChatCompletions (SSE proxy with 4096-byte buffer + Flush), InvokeAgent (create→submit→bundle combined response)
- [x] `cmd/server/main.go` — 5 routes, requestLogger middleware
- [x] `Dockerfile`

---

## 12. trace_query_service ✅

- [x] `internal/handlers/query.go` — ListSessions (paginated, org_id/agent_id filter), GetTrace (chain entries + MinIO payloads + VerifyChain), GetBundle (postgres + MinIO + Ed25519 verify), ExportTrace (download JSON)
- [x] `cmd/server/main.go`
- [x] `Dockerfile`

---

## 13. Frontend ✅

- [x] `package.json` — Next.js 15, React 18, SWR, Zustand, Radix UI, Lucide, Tailwind
- [x] `tsconfig.json`
- [x] `tailwind.config.ts`
- [x] `next.config.ts` — rewrites /v1/* → api_gateway
- [x] `src/app/globals.css` — Tailwind base
- [x] `src/app/layout.tsx` — icon sidebar (Chat/Traces/Harnesses/Admin), dark theme
- [x] `src/app/chat/page.tsx`
- [x] `src/app/traces/page.tsx` — session browser + TraceTimeline + BundleViewer
- [x] `src/app/harnesses/page.tsx` — harness list + editor modal
- [x] `src/app/admin/page.tsx` — user table + API key management (create/revoke)
- [x] `src/types/index.ts` — all domain types
- [x] `src/lib/api.ts` — typed client, SSE streaming async generator
- [x] `src/components/chat/ChatWindow.tsx` — SSE streaming, delta content parsing
- [x] `src/components/trace/TraceTimeline.tsx` — waterfall, EVENT_COLORS/ICONS, IntegrityBadge, hash display
- [x] `src/components/attestation/BundleViewer.tsx` — bundle fields, SignatureBadge, export link
- [x] `Dockerfile` — multi-stage node build, standalone output

---

## Config / Harnesses ✅

- [x] `config/litellm.yaml` — Ollama local models + Anthropic (claude-sonnet-4-6, claude-haiku-4-5) + OpenAI (gpt-4o, gpt-4o-mini)
- [x] `config/mcp_servers.yaml` — recon/threat_intel/redteam server registry
- [x] `config/scope.yaml` — default ROE (deny-all allowlist, RFC1918 denylist)
- [x] `config/harnesses/recon.yaml` — Passive OSINT harness
- [x] `config/harnesses/threat_intel.yaml` — Threat Intel Enrichment harness
- [x] `config/harnesses/redteam.yaml` — AI Red-Team harness

---

## Remaining Manual Steps (environment, not code)

1. **`protoc` compilation** — run `protoc --go_out=. --go-grpc_out=. proto/signing.proto` inside `services/signing_service/` to generate the `signingpb` package
2. **`go mod tidy`** — run in each Go service directory to pull dependencies and generate `go.sum`
3. **Python deps** — `pip install -r requirements.txt` in each Python service directory
4. **`npm install`** — run in `frontend/` before first build
5. **Secrets** — populate `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, `VT_API_KEY`, `OTX_API_KEY`, `SHODAN_API_KEY`, `JWT_RSA_PRIVATE_KEY_PATH` in `.env`
6. **DB migrations** — execute `001_orgs.sql` through `008_agent_configs.sql` in order against postgres before starting services
7. **Rekor (optional)** — set `REKOR_ENABLED=true` and `REKOR_URL` if Sigstore transparency log anchoring is desired

---

## Build Order (dependency critical path)

```
postgres + redis + minio
        ↓
signing_service    auth_service
        ↓               ↓
attestation_service  api_gateway    context_library
        ↓                                ↓
trace_query_service    recon/threat_intel/redteam MCP servers
                                         ↓
                              agent_orchestrator
                                         ↓
                                     frontend
```

---

*Last updated: 2026-08-25 — All 13 components complete.*
