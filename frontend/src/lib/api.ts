// API client — agent/chat traffic goes through api_gateway; auth calls use /auth/* proxy.

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://localhost:8080'
const TRACE_QUERY_URL = process.env.NEXT_PUBLIC_TRACE_QUERY_URL ?? 'http://localhost:8084'

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
