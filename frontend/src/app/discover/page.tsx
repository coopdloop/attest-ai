'use client'

import { useEffect, useState, useCallback } from 'react'
import { analytics, type LogEntry, type ModelStat } from '@/lib/api'
import { TraceDrawer } from '@/components/trace/TraceDrawer'

const WINDOWS = ['24h', '7d', '30d', '90d', 'all'] as const
const STATUSES = ['', 'completed', 'failed', 'streaming', 'pending'] as const
const MODES = ['', 'human', 'machine'] as const
const PAGE_SIZE = 25

function fmtCost(v: number) {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}
function fmtNum(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(v)
}
function shortModel(m: string) {
  return m.replace(/^openrouter\//, '')
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

export default function DiscoverPage() {
  const [window_, setWindow]   = useState<typeof WINDOWS[number]>('7d')
  const [model, setModel]      = useState('')
  const [status, setStatus]    = useState<typeof STATUSES[number]>('')
  const [mode, setMode]        = useState<typeof MODES[number]>('')
  const [page, setPage]        = useState(0)

  const [items, setItems]      = useState<LogEntry[]>([])
  const [total, setTotal]      = useState(0)
  const [models, setModels]    = useState<ModelStat[]>([])
  const [loading, setLoading]  = useState(true)
  const [error, setError]      = useState<string | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [log, byModel] = await Promise.all([
        analytics.log({ window: window_, model, status, mode, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        analytics.byModel(window_),
      ])
      setItems(log.items)
      setTotal(log.total)
      setModels(byModel.models)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activity log')
    } finally {
      setLoading(false)
    }
  }, [window_, model, status, mode, page])

  useEffect(() => { load() }, [load])
  // Any filter change resets pagination back to page 0.
  useEffect(() => { setPage(0) }, [window_, model, status, mode])

  const from = total === 0 ? 0 : page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div className="h-full overflow-y-auto bg-gray-950">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-semibold">Discover</h1>
          <p className="text-sm text-gray-500 mt-0.5">Every model request through this gateway — model, tokens, cost, latency</p>
        </div>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {WINDOWS.map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                window_ === w ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              {w}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm">
          {error} — is trace_query_service running?
        </div>
      )}

      <div className="p-6 space-y-4">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-3">
          <Select label="Model" value={model} onChange={setModel}
            options={[{ value: '', label: 'All models' }, ...models.map(m => ({ value: m.model, label: shortModel(m.model) }))]} />
          <Select label="Status" value={status} onChange={v => setStatus(v as typeof STATUSES[number])}
            options={STATUSES.map(s => ({ value: s, label: s === '' ? 'All statuses' : s }))} />
          <Select label="Caller" value={mode} onChange={v => setMode(v as typeof MODES[number])}
            options={MODES.map(m => ({ value: m, label: m === '' ? 'All callers' : m }))} />
        </div>

        {/* Log table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left px-4 py-2.5 font-medium">Time</th>
                  <th className="text-left px-4 py-2.5 font-medium">Model</th>
                  <th className="text-left px-4 py-2.5 font-medium">Caller</th>
                  <th className="text-left px-4 py-2.5 font-medium">Status</th>
                  <th className="text-right px-4 py-2.5 font-medium">Tokens (in → out)</th>
                  <th className="text-right px-4 py-2.5 font-medium">Cost</th>
                  <th className="text-right px-4 py-2.5 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr
                    key={it.turn_id}
                    onClick={() => setOpenSessionId(it.session_id)}
                    className="border-b border-gray-800/40 hover:bg-gray-800/40 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-2.5 text-gray-400 whitespace-nowrap">{fmtDate(it.started_at)}</td>
                    <td className="px-4 py-2.5 text-gray-200 truncate max-w-[220px]">{shortModel(it.model)}</td>
                    <td className="px-4 py-2.5 text-gray-500">{it.mode}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        it.status === 'completed' ? 'bg-green-900/40 text-green-400' :
                        it.status === 'failed'    ? 'bg-red-900/40 text-red-400' :
                        'bg-gray-800 text-gray-400'
                      }`}>{it.status}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-400 font-mono">
                      {fmtNum(it.input_tokens)} → {fmtNum(it.output_tokens)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-emerald-400 font-mono">{fmtCost(it.cost_usd)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-400 font-mono">{(it.latency_ms / 1000).toFixed(2)}s</td>
                  </tr>
                ))}
                {!loading && items.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-600">No requests in this window</td></tr>
                )}
                {loading && items.length === 0 && (
                  <tr><td colSpan={7} className="py-10 text-center text-gray-600">Loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-800 text-xs text-gray-500">
            <span>{total > 0 ? `Showing ${from}–${to} of ${total}` : ''}</span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 rounded-md bg-gray-800 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => (to < total ? p + 1 : p))}
                disabled={to >= total}
                className="px-2.5 py-1 rounded-md bg-gray-800 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>

      <TraceDrawer sessionId={openSessionId} onClose={() => setOpenSessionId(null)} />
    </div>
  )
}

function Select({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-gray-500 bg-gray-900 border border-gray-800 rounded-lg px-3 py-1.5">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-transparent text-gray-200 text-xs focus:outline-none"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-gray-900">{o.label}</option>
        ))}
      </select>
    </label>
  )
}
