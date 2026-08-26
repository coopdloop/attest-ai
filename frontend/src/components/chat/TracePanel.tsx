'use client'

import { useState, useEffect } from 'react'

export interface ResponseMeta {
  session_id: string
  model: string
  latency_ms: number
  cost_usd: number | null
  iterations: number
  attestation_ids: string[]
  reasoning: string | null
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface TraceEntry {
  id: string
  seq: number
  event_type: string
  chain_hash: string
  prev_hash: string
  created_at: string
  payload?: Record<string, unknown>
}

interface TracePanelProps {
  meta: ResponseMeta | null
  open: boolean
  onClose: () => void
}

const EVENT_COLORS: Record<string, string> = {
  reasoning_step: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  tool_call:      'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  tool_response:  'bg-green-500/20 text-green-300 border-green-500/30',
  completion:     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  error:          'bg-red-500/20 text-red-300 border-red-500/30',
}

function Section({ title, defaultOpen = true, children }: {
  title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-gray-800">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold
                   text-gray-400 uppercase tracking-wider hover:text-gray-200 transition-colors"
      >
        {title}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

function KV({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs text-right ${mono ? 'font-mono text-gray-300' : 'text-gray-300'} break-all`}>
        {String(value)}
      </span>
    </div>
  )
}

export function TracePanel({ meta, open, onClose }: TracePanelProps) {
  const [entries, setEntries] = useState<TraceEntry[]>([])
  const [traceLoading, setTraceLoading] = useState(false)
  const [integrity, setIntegrity] = useState<{ valid: boolean } | null>(null)
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null)

  useEffect(() => {
    if (!meta?.session_id || !open) return
    setEntries([])
    setIntegrity(null)
    setTraceLoading(true)
    fetch(`/tqs/traces/${meta.session_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setEntries(data.entries ?? [])
        setIntegrity(data.integrity ?? null)
      })
      .catch(() => {})
      .finally(() => setTraceLoading(false))
  }, [meta?.session_id, open])

  if (!open) return null

  const { usage } = meta ?? { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }
  const costStr = meta?.cost_usd != null
    ? meta.cost_usd < 0.0001
      ? `< $0.0001`
      : `$${meta.cost_usd.toFixed(5)}`
    : null

  return (
    <aside className="w-80 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <span className="text-sm font-semibold text-gray-200">Response debug</span>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!meta ? (
          <div className="flex items-center justify-center h-32 text-sm text-gray-600">
            Send a message to see debug info
          </div>
        ) : (
          <>
            {/* Performance */}
            <Section title="Performance">
              <KV label="Model"    value={meta.model} />
              <KV label="Latency"  value={`${(meta.latency_ms / 1000).toFixed(2)}s`} />
              <KV label="Cost"     value={costStr} />
              <KV label="Turns"    value={meta.iterations} />
              <div className="mt-2 pt-2 border-t border-gray-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Tokens</span>
                  <span className="text-xs font-mono text-gray-300">{usage.total_tokens.toLocaleString()} total</span>
                </div>
                <div className="flex gap-1 h-1.5 rounded-full overflow-hidden bg-gray-800">
                  {usage.total_tokens > 0 && (
                    <>
                      <div
                        className="bg-blue-500 rounded-l-full"
                        style={{ width: `${(usage.prompt_tokens / usage.total_tokens) * 100}%` }}
                        title={`Input: ${usage.prompt_tokens}`}
                      />
                      <div
                        className="bg-purple-500 rounded-r-full"
                        style={{ width: `${(usage.completion_tokens / usage.total_tokens) * 100}%` }}
                        title={`Output: ${usage.completion_tokens}`}
                      />
                    </>
                  )}
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-blue-400">{usage.prompt_tokens.toLocaleString()} in</span>
                  <span className="text-xs text-purple-400">{usage.completion_tokens.toLocaleString()} out</span>
                </div>
              </div>
            </Section>

            {/* Attestation */}
            <Section title="Attestation">
              <KV label="Session" value={meta.session_id.slice(0, 8) + '…'} mono />
              <KV label="Events"  value={entries.length || meta.attestation_ids.length} />
              {integrity != null && (
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs text-gray-500">Chain</span>
                  <span className={`text-xs font-medium ${integrity.valid ? 'text-green-400' : 'text-red-400'}`}>
                    {integrity.valid ? '✓ Verified' : '✗ Tampered'}
                  </span>
                </div>
              )}
              <div className="mt-2 pt-1">
                <a
                  href={`/tqs/traces/${meta.session_id}/export`}
                  download
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  ↓ Export bundle
                </a>
              </div>
            </Section>

            {/* Chain of thought */}
            {meta.reasoning && (
              <Section title="Chain of thought" defaultOpen>
                <div className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto
                                bg-gray-800/50 rounded-lg p-3 border border-gray-700">
                  {meta.reasoning}
                </div>
              </Section>
            )}

            {/* Trace events */}
            <Section title="Trace events" defaultOpen={false}>
              {traceLoading && (
                <div className="text-xs text-gray-500 py-2">Loading trace…</div>
              )}
              {!traceLoading && entries.length === 0 && (
                <div className="text-xs text-gray-600 py-2">No events yet</div>
              )}
              <div className="space-y-1.5">
                {entries.map(e => (
                  <div key={e.id}>
                    <button
                      onClick={() => setExpandedEntry(expandedEntry === e.id ? null : e.id)}
                      className={`w-full text-left rounded-lg border px-2.5 py-1.5 transition-colors
                                  hover:opacity-80 ${EVENT_COLORS[e.event_type] ?? 'bg-gray-700/40 text-gray-400 border-gray-700'}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{e.event_type}</span>
                        <span className="text-xs opacity-60">#{e.seq}</span>
                      </div>
                      <div className="text-xs opacity-50 font-mono mt-0.5">
                        {e.chain_hash?.slice(0, 12)}…
                      </div>
                    </button>
                    {expandedEntry === e.id && e.payload && (
                      <div className="mt-1 rounded-lg bg-gray-800 border border-gray-700 p-2">
                        <pre className="text-xs text-gray-400 overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>

            {/* Session ID (full) */}
            <Section title="IDs" defaultOpen={false}>
              <KV label="Session" value={meta.session_id} mono />
              {meta.attestation_ids.slice(0, 3).map((id, i) => (
                <KV key={i} label={`Entry ${i + 1}`} value={id.slice(0, 16) + '…'} mono />
              ))}
            </Section>
          </>
        )}
      </div>
    </aside>
  )
}
