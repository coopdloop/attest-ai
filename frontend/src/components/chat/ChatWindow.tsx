'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Message, MessageMeta } from '@/types'
import { ModelSelector, cachedModels } from './ModelSelector'

const DEFAULT_MODEL = 'openrouter/ox-alpha'
const STORAGE_KEY   = 'attest-ai:conversations'

interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  lastMeta: MessageMeta | null
  createdAt: string
}

function newConversation(model: string): Conversation {
  return { id: crypto.randomUUID(), title: 'New chat', messages: [], model, lastMeta: null, createdAt: new Date().toISOString() }
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return [newConversation(DEFAULT_MODEL)]
}

function toAPIMessages(msgs: Message[]) {
  return msgs.map(m => ({ role: m.role, content: m.content }))
}

function stripOr(id: string) {
  return id.startsWith('openrouter/') ? id.slice('openrouter/'.length) : id
}

function getContextLength(model: string): number | null {
  const id = stripOr(model)
  return cachedModels.find(m => m.id === id)?.context_length ?? null
}

function getModelDisplayName(model: string): string {
  const id = stripOr(model)
  return cachedModels.find(m => m.id === id)?.name ?? id.split('/').pop() ?? model
}

export function ChatWindow() {
  const router = useRouter()
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [conversations, setConversations] = useState<Conversation[]>([newConversation(DEFAULT_MODEL)])
  const [activeId, setActiveId]   = useState<string>('')
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [hydrated, setHydrated]       = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeConvo = conversations.find(c => c.id === activeId) ?? conversations[0]

  // Load from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = loadConversations()
    setConversations(stored)
    setActiveId(stored[0]?.id ?? '')
    setHydrated(true)
  }, [])

  // Verify token on mount — catches stale/expired tokens before the first send
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.replace('/login'); return }
    fetch('/auth/tokens/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => {
        if (!data?.active) expireSession()
      })
      .catch(() => expireSession())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function expireSession() {
    ['auth_token', 'org_id', 'user_id'].forEach(k => localStorage.removeItem(k))
    setSessionExpired(true)
    setTimeout(() => router.replace('/login'), 2500)
  }

  // Persist to localStorage (only after hydration so we don't overwrite with defaults)
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)) } catch { /* quota */ }
  }, [conversations, hydrated])

  useEffect(() => {
    if (conversations.length > 0 && !activeId) setActiveId(conversations[0].id)
  }, [conversations, activeId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeConvo?.messages])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  function startNewChat() {
    const convo = newConversation(model)
    setConversations(prev => [convo, ...prev])
    setActiveId(convo.id)
    setInput('')
  }

  function deleteConvo(id: string) {
    setConversations(prev => {
      const next = prev.filter(c => c.id !== id)
      return next.length === 0 ? [newConversation(model)] : next
    })
    if (activeId === id) setActiveId('')
  }

  function updateConvo(id: string, updater: (c: Conversation) => Conversation) {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c))
  }

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return

    const userMsg: Message = { role: 'user', content: input.trim() }
    const currentId    = activeId || conversations[0].id
    const currentModel = model
    const isFirst = (conversations.find(c => c.id === currentId)?.messages.length ?? 0) === 0

    updateConvo(currentId, c => ({
      ...c,
      messages: [...c.messages, userMsg],
      ...(isFirst ? { title: input.trim().slice(0, 50) } : {}),
    }))
    setInput('')
    setLoading(true)

    // Placeholder assistant message
    updateConvo(currentId, c => ({
      ...c,
      messages: [...c.messages, { role: 'assistant', content: '' }],
    }))

    try {
      const token       = localStorage.getItem('auth_token') ?? ''
      const prevMessages = conversations.find(c => c.id === currentId)?.messages ?? []
      const allMessages  = [...prevMessages, userMsg]

      const resp = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          model: currentModel,
          messages: toAPIMessages(allMessages),
          stream: true,
        }),
      })

      if (resp.status === 401) { expireSession(); return }
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

      // --- SSE stream reader ---
      const reader  = resp.body!.getReader()
      const decoder = new TextDecoder()
      let buffer       = ''
      let accText      = ''
      let lastEvent    = ''

      const flush = (line: string) => {
        if (line.startsWith('event: ')) {
          lastEvent = line.slice(7).trim()
          return
        }
        if (!line.startsWith('data: ')) return
        const data = line.slice(6)
        if (data === '[DONE]') return

        if (lastEvent === 'meta') {
          try {
            const raw = JSON.parse(data) as {
              session_id: string; latency_ms: number; cost_usd: number | null
              iterations: number; attestation_ids: string[]; reasoning: string | null
              usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
              model: string
            }
            const msgMeta: MessageMeta = {
              session_id:      raw.session_id,
              model:           raw.model ?? currentModel,
              latency_ms:      raw.latency_ms,
              cost_usd:        raw.cost_usd,
              iterations:      raw.iterations,
              attestation_ids: raw.attestation_ids ?? [],
              reasoning:       raw.reasoning,
              usage:           raw.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
            }
            updateConvo(currentId, c => {
              const msgs = [...c.messages]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], meta: msgMeta }
              return { ...c, messages: msgs, lastMeta: msgMeta }
            })
          } catch { /* ignore */ }
          lastEvent = ''
          return
        }

        try {
          const chunk = JSON.parse(data)
          const content: string = chunk?.choices?.[0]?.delta?.content ?? ''
          if (content) {
            accText += content
            updateConvo(currentId, c => {
              const msgs = [...c.messages]
              msgs[msgs.length - 1] = { role: 'assistant', content: accText }
              return { ...c, messages: msgs }
            })
          }
        } catch { /* ignore */ }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line === '') { lastEvent = ''; continue }
          flush(line)
        }
      }
      // flush remainder
      if (buffer) flush(buffer)

      // If we never got text (error case), put a fallback
      if (!accText) {
        updateConvo(currentId, c => {
          const msgs = [...c.messages]
          if (!msgs[msgs.length - 1].content) {
            msgs[msgs.length - 1] = { role: 'assistant', content: '(no response)' }
          }
          return { ...c, messages: msgs }
        })
      }
    } catch (err) {
      updateConvo(currentId, c => {
        const msgs = [...c.messages]
        msgs[msgs.length - 1] = {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : 'Something went wrong'}`,
        }
        return { ...c, messages: msgs }
      })
    } finally {
      setLoading(false)
    }
  }, [input, loading, activeId, conversations, model, router])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  function logout() {
    ['auth_token', 'org_id', 'user_id'].forEach(k => localStorage.removeItem(k))
    router.replace('/login')
  }

  // Aggregate stats across all messages in the active conversation
  const convoStats = (() => {
    if (!activeConvo) return null
    let totalTokens = 0, totalCost = 0, responseCount = 0, totalLatency = 0
    for (const m of activeConvo.messages) {
      if (m.meta) {
        totalTokens  += m.meta.usage?.total_tokens ?? 0
        totalLatency += m.meta.latency_ms ?? 0
        responseCount++
        // Cost: backend value or client-side fallback from OpenRouter pricing
        if (m.meta.cost_usd != null) {
          totalCost += m.meta.cost_usd
        } else {
          const info = cachedModels.find(mi => mi.id === stripOr(m.meta!.model || ''))
          if (info?.pricing) {
            totalCost += (m.meta.usage?.prompt_tokens ?? 0) * parseFloat(info.pricing.prompt)
              + (m.meta.usage?.completion_tokens ?? 0) * parseFloat(info.pricing.completion)
          }
        }
      }
    }
    return { totalTokens, totalCost, responseCount, avgLatency: responseCount ? totalLatency / responseCount : 0 }
  })()

  const lastMeta = activeConvo?.lastMeta ?? null

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100 overflow-hidden">

      {/* ── Session-expired overlay ───────────────────────── */}
      {sessionExpired && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/90 backdrop-blur-sm">
          <div className="bg-gray-900 border border-yellow-700/60 rounded-2xl px-8 py-6 text-center shadow-2xl max-w-sm">
            <div className="w-10 h-10 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <svg className="w-5 h-5 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <h2 className="text-sm font-semibold text-gray-100 mb-1">Session expired</h2>
            <p className="text-xs text-gray-500">Your session token is no longer valid. Redirecting to login…</p>
            <div className="mt-4 h-1 bg-gray-800 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-500/60 rounded-full animate-[shrink_2.5s_linear_forwards]"
                   style={{ width: '100%', animation: 'width 2.5s linear forwards' }} />
            </div>
            <button
              onClick={() => router.replace('/login')}
              className="mt-4 text-xs text-yellow-400 hover:text-yellow-200 transition-colors"
            >
              Go to login now
            </button>
          </div>
        </div>
      )}

      {/* ── Left sidebar ─────────────────────────────────── */}
      <aside className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200
                         ${sidebarOpen ? 'w-60' : 'w-0 overflow-hidden'}`}>
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-gray-800 shrink-0">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-xs font-bold shrink-0">A</div>
          <span className="font-semibold text-sm">attest-ai</span>
        </div>

        <div className="px-3 pt-3 pb-1 shrink-0">
          <button onClick={startNewChat}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                             bg-blue-600 hover:bg-blue-500 text-white font-medium transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {conversations.map(c => (
            <div key={c.id} className="group relative">
              <button
                onClick={() => setActiveId(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors pr-7
                            ${c.id === activeId ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'}`}
              >
                {c.title}
              </button>
              <button
                onClick={() => deleteConvo(c.id)}
                className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100
                           text-gray-600 hover:text-red-400 transition-all p-1 rounded"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-800 px-4 py-3 space-y-2 shrink-0">
          {[
            { href: '/traces',    label: 'Traces',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
            { href: '/harnesses', label: 'Harnesses', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
            { href: '/admin',     label: 'Admin',     icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
          ].map(({ href, label, icon }) => (
            <a key={href} href={href}
               className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
              </svg>
              {label}
            </a>
          ))}
          <button onClick={logout}
                  className="flex items-center gap-2 text-xs text-gray-500 hover:text-red-400 transition-colors w-full">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Topbar ── */}
        <header className="shrink-0 border-b border-gray-800 bg-gray-950">
          {/* Row 1: sidebar toggle + model selector */}
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button onClick={() => setSidebarOpen(o => !o)}
                    className="text-gray-500 hover:text-gray-300 transition-colors shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <ModelSelector
              value={model}
              onChange={m => { setModel(m); updateConvo(activeId, c => ({ ...c, model: m })) }}
            />
          </div>

          {/* Row 2: conversation stats bar */}
          {(convoStats && convoStats.responseCount > 0) && (
            <div className="flex items-center gap-0 px-4 pb-2.5 overflow-x-auto">
              <StatCell
                label="last latency"
                value={lastMeta ? `${(lastMeta.latency_ms / 1000).toFixed(2)}s` : '—'}
              />
              <StatDivider />
              <StatCell
                label="last tokens"
                value={lastMeta?.usage
                  ? `${(lastMeta.usage.prompt_tokens ?? 0).toLocaleString()} → ${(lastMeta.usage.completion_tokens ?? 0).toLocaleString()}`
                  : '—'}
                sublabel="in → out"
              />
              <StatDivider />
              <StatCell
                label="last cost"
                value={(() => {
                  if (!lastMeta) return '—'
                  const raw = lastMeta.cost_usd
                  const cost = raw != null ? raw : (() => {
                    const info = cachedModels.find(mi => mi.id === stripOr(lastMeta.model || ''))
                    if (!info?.pricing) return null
                    return (lastMeta.usage?.prompt_tokens ?? 0) * parseFloat(info.pricing.prompt)
                      + (lastMeta.usage?.completion_tokens ?? 0) * parseFloat(info.pricing.completion)
                  })()
                  if (cost == null) return '—'
                  return cost === 0 ? 'free' : cost < 0.0001 ? '< $0.0001' : `$${cost.toFixed(5)}`
                })()}
              />
              <StatDivider />
              <StatCell
                label="session tokens"
                value={convoStats.totalTokens.toLocaleString()}
              />
              <StatDivider />
              <StatCell
                label="session cost"
                value={convoStats.totalCost > 0
                  ? convoStats.totalCost < 0.0001 ? '< $0.0001' : `$${convoStats.totalCost.toFixed(4)}`
                  : '—'}
              />
              <StatDivider />
              <StatCell
                label="responses"
                value={String(convoStats.responseCount)}
              />
            </div>
          )}
        </header>

        {/* ── Messages ─────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {(!activeConvo || activeConvo.messages.length === 0) ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-5">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-xl font-bold">A</div>
              </div>
              <h2 className="text-2xl font-semibold text-gray-200 mb-2">How can I help you?</h2>
              <p className="text-gray-500 text-sm max-w-md">
                Cryptographically verifiable reasoning — every step attested.
              </p>
              <div className="mt-6 grid grid-cols-2 gap-2 max-w-lg w-full">
                {[
                  'Scan a domain for open ports',
                  'Analyze a suspicious IP address',
                  'Explain a CVE and its impact',
                  'Draft a threat model for a web app',
                ].map(s => (
                  <button key={s} onClick={() => setInput(s)}
                          className="text-left px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700
                                     text-sm text-gray-300 border border-gray-700 hover:border-gray-600
                                     transition-colors leading-snug">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 w-full">
              {activeConvo.messages.map((msg, i) => (
                <MessageRow
                  key={i}
                  message={msg}
                  isLast={i === activeConvo.messages.length - 1}
                  loading={loading}
                  currentModel={model}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* ── Input ─────────────────────────────────────────── */}
        <div className="shrink-0 border-t border-gray-800 bg-gray-950 px-4 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 bg-gray-800 border border-gray-700
                            rounded-2xl px-4 py-3 focus-within:border-gray-500 transition-colors">
              <textarea
                ref={textareaRef}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                placeholder="Message attest-ai… (Enter ↵ to send)"
                className="flex-1 bg-transparent resize-none text-sm text-gray-100
                           placeholder-gray-600 focus:outline-none min-h-[24px] max-h-[200px]
                           leading-6 disabled:opacity-50"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                           bg-blue-600 hover:bg-blue-500 disabled:opacity-30
                           disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-center text-xs text-gray-700 mt-2">
              Responses are cryptographically signed and stored as attestation bundles.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Topbar stat helpers ──────────────────────────────────────────────────────

function StatCell({ label, value, sublabel }: { label: string; value: string; sublabel?: string }) {
  return (
    <div className="flex flex-col px-3 py-0.5 min-w-fit">
      <span className="text-[10px] text-gray-600 uppercase tracking-wide leading-none">{label}</span>
      <span className="text-xs text-gray-300 font-mono leading-snug mt-0.5">{value}</span>
      {sublabel && <span className="text-[10px] text-gray-700 leading-none">{sublabel}</span>}
    </div>
  )
}

function StatDivider() {
  return <div className="w-px h-6 bg-gray-800 shrink-0" />
}

// ── Per-message inline meta ──────────────────────────────────────────────────

function MessageMiniMeta({ meta, currentModel }: { meta: MessageMeta; currentModel: string }) {
  const [showReasoning, setShowReasoning] = useState(false)

  const usedModel    = meta.model || currentModel
  const contextLen   = getContextLength(usedModel)
  const totalTok     = meta.usage?.total_tokens ?? 0
  const pct          = contextLen && totalTok ? ((totalTok / contextLen) * 100).toFixed(1) : null
  const modelName    = getModelDisplayName(usedModel)

  // Cost: prefer backend value, fall back to client-side calc from OpenRouter pricing
  const effectiveCost = (() => {
    if (meta.cost_usd != null) return meta.cost_usd
    const modelInfo = cachedModels.find(m => m.id === stripOr(usedModel))
    if (!modelInfo?.pricing) return null
    const pIn  = parseFloat(modelInfo.pricing.prompt)
    const pOut = parseFloat(modelInfo.pricing.completion)
    if (!isFinite(pIn) || !isFinite(pOut)) return null
    return (meta.usage?.prompt_tokens ?? 0) * pIn +
           (meta.usage?.completion_tokens ?? 0) * pOut
  })()

  const costStr = effectiveCost != null
    ? effectiveCost === 0 ? 'free'
    : effectiveCost < 0.0001 ? '< $0.0001'
    : `$${effectiveCost.toFixed(5)}`
    : null

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
        {/* Info icon with legend tooltip */}
        <div className="group relative inline-flex items-center">
          <svg className="w-3 h-3 text-gray-700 hover:text-gray-500 cursor-default transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="absolute bottom-full left-0 mb-2 z-50 hidden group-hover:block pointer-events-none">
            <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2.5 shadow-xl w-64">
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-semibold">Response metrics</p>
              <div className="space-y-1.5">
                {[
                  ['Model', 'The LLM that generated this response'],
                  ['% ctx', 'Context window used — total tokens ÷ model max'],
                  ['N₁ → N₂', 'Prompt tokens sent → completion tokens received'],
                  ['1.2s', 'End-to-end latency from send to last token'],
                  ['$0.0001', 'Estimated API cost for this response'],
                  ['✓ attested', 'Cryptographically signed trace events stored'],
                  ['reasoning', 'Chain-of-thought the model returned (expandable)'],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-gray-400 font-mono text-[10px] w-16 shrink-0 leading-relaxed">{k}</span>
                    <span className="text-gray-500 text-[10px] leading-relaxed">{v}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-gray-800">
                <div className="flex gap-2 items-center">
                  <div className="flex gap-0.5 h-1.5 w-12 rounded-full overflow-hidden bg-gray-800">
                    <div className="bg-blue-600/70 w-8 rounded-l-full" />
                    <div className="bg-purple-500/70 flex-1 rounded-r-full" />
                  </div>
                  <span className="text-[10px] text-gray-600">blue = prompt, purple = completion</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Model + context */}
        <span className="text-gray-500 font-medium">{modelName}</span>
        {contextLen && (
          <span title={`${totalTok.toLocaleString()} / ${contextLen.toLocaleString()} tokens`}>
            {pct}% ctx
            <span className="text-gray-700 ml-1">({totalTok.toLocaleString()} / {contextLen.toLocaleString()})</span>
          </span>
        )}
        {!contextLen && totalTok > 0 && (
          <span>{totalTok.toLocaleString()} tok</span>
        )}

        <span className="text-gray-700">·</span>

        {/* Token breakdown */}
        <span title="prompt tokens → completion tokens">
          <span className="text-blue-700">{(meta.usage?.prompt_tokens ?? 0).toLocaleString()}</span>
          <span className="text-gray-700"> → </span>
          <span className="text-purple-700">{(meta.usage?.completion_tokens ?? 0).toLocaleString()}</span>
        </span>

        <span className="text-gray-700">·</span>

        {/* Latency */}
        <span>{(meta.latency_ms / 1000).toFixed(2)}s</span>

        {/* Cost */}
        {costStr && (
          <>
            <span className="text-gray-700">·</span>
            <span>{costStr}</span>
          </>
        )}

        {/* Attestation */}
        {meta.attestation_ids.length > 0 && (
          <>
            <span className="text-gray-700">·</span>
            <span className="text-green-700" title={`${meta.attestation_ids.length} attested events`}>
              ✓ attested ({meta.attestation_ids.length})
            </span>
          </>
        )}

        {/* Reasoning toggle */}
        {meta.reasoning && (
          <>
            <span className="text-gray-700">·</span>
            <button
              onClick={() => setShowReasoning(r => !r)}
              className="text-blue-600 hover:text-blue-400 transition-colors"
            >
              {showReasoning ? 'hide' : 'show'} reasoning
            </button>
          </>
        )}
      </div>

      {/* Context bar */}
      {contextLen && totalTok > 0 && (
        <div className="flex gap-0.5 h-1 rounded-full overflow-hidden bg-gray-800/80 max-w-[240px]">
          <div
            className="bg-blue-600/70 rounded-l-full"
            style={{ width: `${(meta.usage.prompt_tokens / contextLen) * 100}%` }}
          />
          <div
            className="bg-purple-500/70 rounded-r-full"
            style={{ width: `${(meta.usage.completion_tokens / contextLen) * 100}%` }}
          />
        </div>
      )}

      {/* Reasoning block */}
      {showReasoning && meta.reasoning && (
        <div className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto
                        bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
          {meta.reasoning}
        </div>
      )}
    </div>
  )
}

// ── Message row ──────────────────────────────────────────────────────────────

function MessageRow({
  message, isLast, loading, currentModel,
}: {
  message: Message
  isLast: boolean
  loading: boolean
  currentModel: string
}) {
  const isUser  = message.role === 'user'
  const isEmpty = !message.content && isLast && loading

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] bg-blue-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-lg bg-gray-700 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-xs font-bold text-gray-300">A</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm leading-relaxed text-gray-100 whitespace-pre-wrap">
          {isEmpty ? (
            <span className="inline-flex items-center gap-1 text-gray-500">
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </span>
          ) : message.content}
        </div>
        {message.meta && (
          <MessageMiniMeta meta={message.meta} currentModel={currentModel} />
        )}
      </div>
    </div>
  )
}
