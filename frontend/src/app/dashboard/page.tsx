'use client'

import { useEffect, useState, useCallback } from 'react'
import { analytics, type AnalyticsOverview, type TimeseriesPoint, type ModelStat, type RecentSession } from '@/lib/api'
import { AreaChart, BarChart, Donut, PALETTE } from '@/components/charts/Charts'

const WINDOWS = ['24h', '7d', '30d', '90d'] as const

function fmtCost(v: number) {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}
function fmtNum(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return String(Math.round(v))
}
function shortModel(m: string) {
  return m.replace(/^openrouter\//, '').split('/').pop() ?? m
}

export default function DashboardPage() {
  const [window, setWindow] = useState<typeof WINDOWS[number]>('7d')
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [series, setSeries] = useState<TimeseriesPoint[]>([])
  const [models, setModels] = useState<ModelStat[]>([])
  const [recent, setRecent] = useState<RecentSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [ov, ts, bm] = await Promise.all([
        analytics.overview(window),
        analytics.timeseries(window),
        analytics.byModel(window),
      ])
      setOverview(ov)
      setSeries(ts.points)
      setModels(bm.models)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [window])

  useEffect(() => { setLoading(true); load() }, [load])

  // Live ticker: poll recent sessions every 4s.
  useEffect(() => {
    let alive = true
    const tick = () => analytics.recent(12).then(r => { if (alive) setRecent(r.sessions) }).catch(() => {})
    tick()
    const id = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  return (
    <div className="h-full overflow-y-auto bg-gray-950">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Command Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Real-time usage, cost & model analytics</p>
        </div>
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {WINDOWS.map(w => (
            <button key={w} onClick={() => setWindow(w)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                window === w ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
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

      <div className="p-6 space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
          <Kpi label="Total spend" value={overview ? fmtCost(overview.total_cost_usd) : '—'} accent="text-emerald-400" loading={loading} />
          <Kpi label="Requests" value={overview ? fmtNum(overview.sessions) : '—'} loading={loading} />
          <Kpi label="Tokens" value={overview ? fmtNum(overview.total_tokens) : '—'} loading={loading} />
          <Kpi label="p95 latency" value={overview ? `${(overview.p95_latency_ms / 1000).toFixed(2)}s` : '—'} loading={loading} />
          <Kpi label="Error rate" value={overview ? `${overview.error_rate.toFixed(1)}%` : '—'}
               accent={overview && overview.error_rate > 5 ? 'text-red-400' : 'text-gray-100'} loading={loading} />
          <Kpi label="Models used" value={overview ? String(overview.distinct_models) : '—'} loading={loading} />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Panel title="Spend over time" className="xl:col-span-2">
            <AreaChart data={series as unknown as Array<Record<string, number | string>>}
                       valueKey="cost_usd" color="#10b981" fill="rgba(16,185,129,0.14)"
                       format={fmtCost} />
          </Panel>
          <Panel title="Model mix">
            <div className="flex flex-col items-center gap-3">
              <Donut data={models.slice(0, 8).map((m, i) => ({
                label: shortModel(m.model), value: m.requests, color: PALETTE[i % PALETTE.length],
              }))} />
              <div className="w-full space-y-1">
                {models.slice(0, 5).map((m, i) => (
                  <div key={m.model} className="flex items-center gap-2 text-xs">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="text-gray-300 truncate flex-1">{shortModel(m.model)}</span>
                    <span className="text-gray-500 font-mono">{m.requests}</span>
                  </div>
                ))}
              </div>
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Panel title="Request volume">
            <BarChart data={series as unknown as Array<Record<string, number | string>>}
                      valueKey="requests" labelKey="ts" color="#3b82f6" />
          </Panel>
          <Panel title="Tokens over time">
            <AreaChart data={series as unknown as Array<Record<string, number | string>>}
                       valueKey="tokens" color="#8b5cf6" fill="rgba(139,92,246,0.14)" format={fmtNum} />
          </Panel>
        </div>

        {/* Model leaderboard + live ticker */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Panel title="Model leaderboard">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 font-medium">Model</th>
                  <th className="text-right py-2 font-medium">Reqs</th>
                  <th className="text-right py-2 font-medium">Tokens</th>
                  <th className="text-right py-2 font-medium">Cost</th>
                  <th className="text-right py-2 font-medium">Avg</th>
                </tr>
              </thead>
              <tbody>
                {models.slice(0, 10).map(m => (
                  <tr key={m.model} className="border-b border-gray-800/40">
                    <td className="py-2 text-gray-200 truncate max-w-[160px]">{shortModel(m.model)}</td>
                    <td className="py-2 text-right text-gray-400 font-mono">{m.requests}</td>
                    <td className="py-2 text-right text-gray-400 font-mono">{fmtNum(m.tokens)}</td>
                    <td className="py-2 text-right text-emerald-400 font-mono">{fmtCost(m.cost_usd)}</td>
                    <td className="py-2 text-right text-gray-400 font-mono">{(m.avg_latency_ms / 1000).toFixed(1)}s</td>
                  </tr>
                ))}
                {models.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-gray-600">No model data yet</td></tr>
                )}
              </tbody>
            </table>
          </Panel>

          <Panel title={<span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live request ticker
          </span>}>
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {recent.map(s => (
                <div key={s.session_id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-800/40 animate-[fadeIn_0.3s_ease]">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    s.status === 'completed' ? 'bg-emerald-500' :
                    s.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                  <span className="text-gray-300 truncate flex-1">{shortModel(s.model)}</span>
                  <span className="text-gray-600">{s.mode}</span>
                  <span className="text-gray-500 font-mono">{fmtNum(s.tokens)} tok</span>
                  <span className="text-emerald-500/80 font-mono w-14 text-right">{fmtCost(s.cost_usd)}</span>
                  <span className="text-gray-600 font-mono w-12 text-right">{(s.latency_ms / 1000).toFixed(1)}s</span>
                </div>
              ))}
              {recent.length === 0 && (
                <div className="py-6 text-center text-gray-600 text-xs">Waiting for requests…</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  )
}

function Kpi({ label, value, accent, loading }: { label: string; value: string; accent?: string; loading?: boolean }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-gray-100'} ${loading ? 'opacity-40' : ''}`}>{value}</p>
    </div>
  )
}

function Panel({ title, children, className }: { title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className ?? ''}`}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">{title}</h3>
      {children}
    </div>
  )
}
