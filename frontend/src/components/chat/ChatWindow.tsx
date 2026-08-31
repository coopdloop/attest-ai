'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Message, MessageMeta } from '@/types'
import { ModelSelector, cachedModels } from './ModelSelector'
import { BundleViewer } from '@/components/attestation/BundleViewer'
import { Modal } from '@/components/ui/Modal'

const DEFAULT_MODEL = 'openrouter/ox-alpha'
const STORAGE_KEY   = 'attest-ai:conversations'

interface Conversation {
  id: string
  title: string
  messages: Message[]
  model: string
  lastMeta: MessageMeta | null
  createdAt: string
  pending?: string   // first message queued from the starter screen; auto-sent on load
}

function newConversation(model: string): Conversation {
  return { id: crypto.randomUUID(), title: 'New chat', messages: [], model, lastMeta: null, createdAt: new Date().toISOString() }
}

function loadConversations(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch { /* ignore */ }
  return []
}

function saveConversations(cs: Conversation[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cs)) } catch { /* quota */ }
}

// Create a new conversation seeded with a first message and persist it, returning
// the new id. Used by the starter screen before navigating to /chat/<id>.
export function createConversationWithMessage(model: string, text: string): string {
  const convo: Conversation = {
    ...newConversation(model),
    title: text.slice(0, 50) || 'New chat',
    pending: text,
  }
  saveConversations([convo, ...loadConversations()])
  return convo.id
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

export function ChatWindow({ chatId }: { chatId: string }) {
  const router = useRouter()
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const activeId = chatId
  const [input, setInput]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [hydrated, setHydrated]       = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [notFound, setNotFound]       = useState(false)
  const [legendHover, setLegendHover] = useState(false)
  const [legendPinned, setLegendPinned] = useState(false)
  const bottomRef   = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoSentRef = useRef<Set<string>>(new Set())

  const activeConvo = conversations.find(c => c.id === activeId) ?? null

  // Load from localStorage after hydration to avoid SSR mismatch
  useEffect(() => {
    const stored = loadConversations()
    setConversations(stored)
    setHydrated(true)
    if (stored.length > 0 && !stored.some(c => c.id === chatId)) {
      setNotFound(true)
    }
    const active = stored.find(c => c.id === chatId)
    if (active) setModel(active.model)
  }, [chatId])

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
    saveConversations(conversations)
  }, [conversations, hydrated])

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
    router.push('/chat')
  }

  function deleteConvo(id: string) {
    const remaining = conversations.filter(c => c.id !== id)
    setConversations(remaining)
    saveConversations(remaining)
    if (activeId === id) {
      router.push(remaining.length > 0 ? `/chat/${remaining[0].id}` : '/chat')
    }
  }

  function updateConvo(id: string, updater: (c: Conversation) => Conversation) {
    setConversations(prev => prev.map(c => c.id === id ? updater(c) : c))
  }

  // Re-fetch the bundle from trace_query_service, which verifies the Ed25519
  // signature, then merge signature_valid into the last message's meta.
  const verifyBundle = useCallback(async (convoId: string, sessionId: string) => {
    // Small delay: finalize runs at end of stream; give the write a moment to land.
    await new Promise(r => setTimeout(r, 600))
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(`/tqs/traces/${sessionId}/bundle`)
        if (resp.ok) {
          const verified = await resp.json()
          updateConvo(convoId, c => {
            const msgs = [...c.messages]
            const last = msgs[msgs.length - 1]
            if (last?.meta?.attestation_bundle) {
              last.meta = {
                ...last.meta,
                attestation_bundle: { ...last.meta.attestation_bundle, ...verified },
              }
              msgs[msgs.length - 1] = { ...last }
            }
            return { ...c, messages: msgs }
          })
          return
        }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 800))
    }
  }, [])

  const sendMessage = useCallback(async (overrideText?: string) => {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return

    const userMsg: Message = { role: 'user', content: text }
    const currentId    = activeId
    const currentModel = model
    if (!currentId) return
    const isFirst = (conversations.find(c => c.id === currentId)?.messages.length ?? 0) === 0

    updateConvo(currentId, c => ({
      ...c,
      messages: [...c.messages, userMsg],
      ...(isFirst ? { title: text.slice(0, 50) } : {}),
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
              model: string; attestation_bundle?: MessageMeta['attestation_bundle']
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
              attestation_bundle: raw.attestation_bundle,
            }
            updateConvo(currentId, c => {
              const msgs = [...c.messages]
              msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], meta: msgMeta }
              return { ...c, messages: msgs, lastMeta: msgMeta }
            })

            // Verify the signature after the stream ends. The inline bundle proves
            // it was signed; trace_query_service re-checks the Ed25519 signature
            // against the org public key and returns signature_valid.
            if (msgMeta.attestation_bundle && msgMeta.session_id) {
              verifyBundle(currentId, msgMeta.session_id)
            }
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
  }, [input, loading, activeId, conversations, model, router, verifyBundle])

  // Auto-send a pending first message queued by the starter screen.
  useEffect(() => {
    if (!hydrated || !activeConvo?.pending || loading) return
    if (autoSentRef.current.has(activeConvo.id)) return
    autoSentRef.current.add(activeConvo.id)
    const pending = activeConvo.pending
    updateConvo(activeConvo.id, c => { const { pending: _p, ...rest } = c; return rest })
    sendMessage(pending)
  }, [hydrated, activeConvo, loading, sendMessage])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
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

      {/* ── Chat conversation panel (secondary sidebar) ─────── */}
      <aside className={`flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-200
                         ${sidebarOpen ? 'w-60' : 'w-0 overflow-hidden'}`}>
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-800 shrink-0">
          <span className="font-semibold text-sm text-gray-300">Chats</span>
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
                onClick={() => router.push(`/chat/${c.id}`)}
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
              onChange={m => { setModel(m); if (activeId) updateConvo(activeId, c => ({ ...c, model: m })) }}
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
          {(!hydrated) ? (
            <div className="h-full" />
          ) : (notFound || !activeConvo) ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-14 h-14 bg-gray-800 rounded-2xl flex items-center justify-center mb-5 text-gray-500">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-200 mb-2">Chat not found</h2>
              <p className="text-gray-500 text-sm max-w-md mb-5">
                This conversation doesn&apos;t exist on this device, or was deleted.
              </p>
              <button onClick={() => router.push('/chat')}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
                Start a new chat
              </button>
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
                  legend={{
                    pinned: legendPinned,
                    onEnter: () => setLegendHover(true),
                    onLeave: () => setLegendHover(false),
                    onToggle: () => setLegendPinned(p => !p),
                  }}
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
                onClick={() => sendMessage()}
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

      {/* Single shared metrics legend (one at a time across all messages) */}
      <MetricsLegend
        open={legendHover || legendPinned}
        pinned={legendPinned}
        onPin={() => setLegendPinned(p => !p)}
        onClose={() => { setLegendPinned(false); setLegendHover(false) }}
      />
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

interface LegendControl {
  pinned: boolean
  onEnter: () => void
  onLeave: () => void
  onToggle: () => void
}

function MessageMiniMeta({ meta, currentModel, legend }: {
  meta: MessageMeta; currentModel: string; legend: LegendControl
}) {
  const [showReasoning, setShowReasoning] = useState(false)
  const [showBundle, setShowBundle] = useState(false)

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
        {/* Info icon: hover to peek the metrics legend, click to pin/unpin it */}
        <button
          onMouseEnter={legend.onEnter}
          onMouseLeave={legend.onLeave}
          onClick={legend.onToggle}
          className={`inline-flex items-center transition-colors ${legend.pinned ? 'text-blue-400' : 'text-gray-700 hover:text-gray-400'}`}
          title="Metrics legend — click to pin"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

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

        {/* Signed bundle modal trigger */}
        {meta.attestation_bundle && (
          <>
            <span className="text-gray-700">·</span>
            <button
              onClick={() => setShowBundle(true)}
              className="text-emerald-600 hover:text-emerald-400 transition-colors"
              title="View the signed attestation bundle for this response"
            >
              🧾 view receipt
            </button>
          </>
        )}

        {/* Jump to full trace page */}
        {meta.session_id && (
          <>
            <span className="text-gray-700">·</span>
            <a
              href={`/traces/${meta.session_id}`}
              className="text-blue-600 hover:text-blue-400 transition-colors"
              title="Open the full trace timeline for this session"
            >
              open trace ↗
            </a>
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

      {/* Full signed attestation bundle (modal) */}
      {meta.attestation_bundle && (
        <Modal
          open={showBundle}
          onClose={() => setShowBundle(false)}
          title="Attestation Receipt"
          maxWidth="max-w-lg"
        >
          <BundleViewer bundle={meta.attestation_bundle} sessionId={meta.session_id} />
          <div className="mt-4 flex items-center justify-between text-xs">
            <span className="text-gray-600">
              This receipt was returned with the response. The signature is
              re-verified against the org public key.
            </span>
          </div>
          <a
            href={`/traces/${meta.session_id}`}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            View full trace timeline ↗
          </a>
        </Modal>
      )}
    </div>
  )
}

// ── Metrics legend side panel ────────────────────────────────────────────────

function MetricsLegend({ open, pinned, onPin, onClose }: {
  open: boolean; pinned: boolean; onPin: () => void; onClose: () => void
}) {
  return (
    <div
      className={`fixed top-0 right-0 z-40 h-screen w-72 bg-gray-900 border-l border-gray-800 shadow-2xl
                  transition-transform duration-200 ease-out flex flex-col
                  ${open ? 'translate-x-0' : 'translate-x-full'}`}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Response metrics</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onPin}
            title={pinned ? 'Unpin' : 'Pin'}
            className={`p-1 rounded transition-colors ${pinned ? 'text-blue-400 hover:text-blue-300' : 'text-gray-600 hover:text-gray-300'}`}
          >
            <svg className="w-3.5 h-3.5" fill={pinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>
          {pinned && (
            <button onClick={onClose} title="Close" className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
        {[
          ['Model', 'The LLM that generated this response'],
          ['% ctx', 'Context window used — total tokens ÷ model max'],
          ['N₁ → N₂', 'Prompt tokens sent → completion tokens received'],
          ['1.2s', 'End-to-end latency from send to last token'],
          ['$0.0001', 'Estimated API cost for this response'],
          ['✓ attested', 'Cryptographically signed trace events stored'],
          ['reasoning', 'Chain-of-thought the model returned (expandable)'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <span className="text-gray-300 font-mono text-xs w-20 shrink-0">{k}</span>
            <span className="text-gray-500 text-xs leading-relaxed">{v}</span>
          </div>
        ))}
        <div className="mt-2 pt-3 border-t border-gray-800">
          <div className="flex gap-2 items-center">
            <div className="flex gap-0.5 h-1.5 w-12 rounded-full overflow-hidden bg-gray-800">
              <div className="bg-blue-600/70 w-8 rounded-l-full" />
              <div className="bg-purple-500/70 flex-1 rounded-r-full" />
            </div>
            <span className="text-xs text-gray-600">blue = prompt, purple = completion</span>
          </div>
        </div>
      </div>

      <div className="px-4 py-2.5 border-t border-gray-800 shrink-0">
        <span className="text-[10px] text-gray-600">
          {pinned ? 'Pinned · click the info icon to unpin' : 'Hover to peek · click the info icon to pin'}
        </span>
      </div>
    </div>
  )
}

// ── Message row ──────────────────────────────────────────────────────────────

function MessageRow({
  message, isLast, loading, currentModel, legend,
}: {
  message: Message
  isLast: boolean
  loading: boolean
  currentModel: string
  legend: LegendControl
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
          <MessageMiniMeta meta={message.meta} currentModel={currentModel} legend={legend} />
        )}
      </div>
    </div>
  )
}
