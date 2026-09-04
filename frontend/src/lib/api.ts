// API client — agent/chat traffic goes through api_gateway; auth calls use /auth/* proxy.

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080'
export const TRACE_QUERY_URL = process.env.NEXT_PUBLIC_TRACE_QUERY_URL ?? 'http://localhost:8084'

function getToken(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('auth_token')
}

async function apiFetch<T>(
  baseURL: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }

  const resp = await fetch(`${baseURL}${path}`, { ...options, headers })

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }))
    throw new Error(err.error ?? `HTTP ${resp.status}`)
  }

  return resp.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const auth = {
  login: async (email: string, password: string) => {
    const data = await apiFetch<{
      access_token: string
      refresh_token: string
      expires_in: number
      org_id: string
      user_id: string
    }>('/auth', '/login', { method: 'POST', body: JSON.stringify({ email, password }) })

    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', data.access_token)
      localStorage.setItem('org_id', data.org_id)
      localStorage.setItem('user_id', data.user_id)
    }
    return data
  },

  register: async (email: string, password: string, orgName: string) =>
    apiFetch<{ user_id: string; org_id: string }>('/auth', '/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, org_name: orgName }),
    }),
}

// ── Chat / Completions ────────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
}

export const chat = {
  complete: (req: ChatCompletionRequest) =>
    apiFetch<unknown>(GATEWAY_URL, '/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  streamComplete: async function* (
    req: ChatCompletionRequest,
    onChunk: (chunk: string) => void,
  ): AsyncGenerator<string> {
    const token = getToken()
    const resp = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ ...req, stream: true }),
    })

    if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      onChunk(chunk)
      yield chunk
    }
  },
}

// ── Agents ────────────────────────────────────────────────────────────────────

export const agents = {
  list: () => apiFetch<unknown[]>(GATEWAY_URL, '/v1/agents'),

  invoke: (agentId: string, input: string, contextOverrides?: Record<string, unknown>) =>
    apiFetch<{ completion: unknown; attestation_bundle: unknown }>(
      GATEWAY_URL, `/v1/agents/${agentId}/invoke`,
      { method: 'POST', body: JSON.stringify({ input, context_overrides: contextOverrides }) }
    ),
}

// ── Traces ────────────────────────────────────────────────────────────────────

export const traces = {
  list: (params: { org_id?: string; agent_id?: string; limit?: number; offset?: number }) =>
    apiFetch<unknown[]>(
      TRACE_QUERY_URL,
      `/traces?${new URLSearchParams(params as Record<string, string>).toString()}`
    ),

  get: (sessionId: string) =>
    apiFetch<unknown>(TRACE_QUERY_URL, `/traces/${sessionId}`),

  getBundle: (sessionId: string) =>
    apiFetch<unknown>(TRACE_QUERY_URL, `/traces/${sessionId}/bundle`),

  export: (sessionId: string) =>
    `${TRACE_QUERY_URL}/traces/${sessionId}/export`,
}

// ── Rate limits ───────────────────────────────────────────────────────────────

export const rateLimits = {
  get: () => apiFetch<{ limit: number; remaining: number; reset_at: string }>(
    GATEWAY_URL, '/v1/rate-limits'
  ),
}

// ── Analytics (Command Center) ─────────────────────────────────────────────────

function orgId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('org_id') ?? ''
}

// All analytics/trust/governance endpoints live on trace_query_service, proxied
// through Next at /tqs/*.
async function tqs<T>(path: string): Promise<T> {
  const resp = await fetch(`/tqs${path}`)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

export const analytics = {
  overview: (window = '7d') =>
    tqs<AnalyticsOverview>(`/analytics/overview?org_id=${orgId()}&window=${window}`),
  timeseries: (window = '7d', bucket?: string) =>
    tqs<{ bucket: string; points: TimeseriesPoint[] }>(
      `/analytics/timeseries?org_id=${orgId()}&window=${window}${bucket ? `&bucket=${bucket}` : ''}`),
  byModel: (window = '7d') =>
    tqs<{ models: ModelStat[] }>(`/analytics/by-model?org_id=${orgId()}&window=${window}`),
  recent: (limit = 15) =>
    tqs<{ sessions: RecentSession[] }>(`/analytics/recent?org_id=${orgId()}&limit=${limit}`),
  log: (params: { window?: string; model?: string; status?: string; mode?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams({ org_id: orgId() })
    if (params.window) qs.set('window', params.window)
    if (params.model)  qs.set('model', params.model)
    if (params.status) qs.set('status', params.status)
    if (params.mode)   qs.set('mode', params.mode)
    qs.set('limit', String(params.limit ?? 25))
    qs.set('offset', String(params.offset ?? 0))
    return tqs<LogResp>(`/analytics/log?${qs.toString()}`)
  },
}

export const trust = {
  score: (window = '30d') =>
    tqs<TrustScoreResp>(`/attestation/trust-score?org_id=${orgId()}&window=${window}`),
  verifyBatch: (limit = 50) =>
    tqs<VerifyBatchResp>(`/attestation/verify-batch?org_id=${orgId()}&limit=${limit}`),
  auditLog: (limit = 100) =>
    tqs<{ entries: AuditEntry[] }>(`/attestation/audit-log?org_id=${orgId()}&limit=${limit}`),
  publicVerify: (sessionId: string) =>
    tqs<PublicVerifyResp>(`/verify/${sessionId}`),
}

export const governance = {
  keys: (window = '30d') =>
    tqs<{ keys: GovKey[] }>(`/governance/keys?org_id=${orgId()}&window=${window}`),
  alerts: (limit = 50) =>
    tqs<{ alerts: GovAlert[]; count: number }>(`/governance/alerts?org_id=${orgId()}&limit=${limit}`),
}

export interface AnalyticsOverview {
  window: string; sessions: number; completed: number; failed: number; active: number
  total_tokens: number; total_cost_usd: number; avg_latency_ms: number
  p50_latency_ms: number; p95_latency_ms: number; error_rate: number
  distinct_models: number; active_keys: number
}
export interface TimeseriesPoint {
  ts: string; requests: number; failed: number; tokens: number; cost_usd: number; avg_latency_ms: number
}
export interface ModelStat {
  model: string; requests: number; tokens: number; cost_usd: number; avg_latency_ms: number; failed: number
}
export interface RecentSession {
  session_id: string; model: string; mode: string; status: string
  tokens: number; cost_usd: number; latency_ms: number; started_at: string
}
export interface LogEntry {
  turn_id: string; session_id: string; model: string; mode: string; status: string
  input_tokens: number; output_tokens: number
  cost_usd: number; latency_ms: number; started_at: string
}
export interface LogResp {
  items: LogEntry[]; total: number; limit: number; offset: number
}
export interface TrustScoreResp {
  window: string; total_sessions: number; completed_sessions: number
  signed_bundles: number; signing_events: number; coverage_pct: number
}
export interface VerifyResult {
  session_id: string; model_id: string; event_count: number; root_hash: string
  signing_key_id: string; signature_valid: boolean; chain_valid: boolean
  verified: boolean; created_at: string
}
export interface VerifyBatchResp {
  checked: number; verified: number; signature_fails: number; chain_fails: number
  results: VerifyResult[]
}
export interface AuditEntry {
  key_id: string; digest: string; caller_service: string; signed_at: string
}
export interface PublicVerifyResp {
  session_id: string; verified: boolean; signature_valid: boolean; chain_valid: boolean
  root_hash: string; signing_key_id: string; event_count: number; model_id: string
  signed_at: string; algorithm: string; verified_at: string; error?: string
}
export interface GovKey {
  id: string; name: string; key_prefix: string; scopes: string[]
  budget_usd: number | null; monthly_quota: number | null
  last_used_at: string | null; expires_at: string | null; revoked_at: string | null
  created_at: string; status: string
  requests: number; cost_usd: number; tokens: number; failed: number; budget_burn_pct: number
}
export interface GovAlert {
  type: string; severity: string; title: string; detail: string
  session_id?: string; created_at: string
}
