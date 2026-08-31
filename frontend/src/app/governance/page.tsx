'use client'

import { useEffect, useState, useCallback } from 'react'
import { governance, analytics, type GovKey, type GovAlert, type RecentSession } from '@/lib/api'

function getAuth() {
  if (typeof window === 'undefined') return null
  const token = localStorage.getItem('auth_token')
  const orgId = localStorage.getItem('org_id')
  return token && orgId ? { token, orgId } : null
}

function fmtCost(v: number) {
  if (v === 0) return '$0'
  if (v < 0.01) return `$${v.toFixed(4)}`
  return `$${v.toFixed(2)}`
}
function shortModel(m: string) { return m.replace(/^openrouter\//, '').split('/').pop() ?? m }

export default function GovernancePage() {
  const [keys, setKeys] = useState<GovKey[]>([])
  const [alerts, setAlerts] = useState<GovAlert[]>([])
  const [recent, setRecent] = useState<RecentSession[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [k, a] = await Promise.all([governance.keys('30d'), governance.alerts(40)])
      setKeys(k.keys)
      setAlerts(a.alerts)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load governance data')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Live attributed request stream.
  useEffect(() => {
    let alive = true
    const tick = () => analytics.recent(10).then(r => { if (alive) setRecent(r.sessions) }).catch(() => {})
    tick()
    const id = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const revokeKey = useCallback(async (id: string) => {
    const auth = getAuth()
    if (!auth) return
    setBusy(id)
    try {
      await fetch(`/auth/orgs/${auth.orgId}/api-keys/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${auth.token}` },
      })
      setKeys(prev => prev.map(k => k.id === id ? { ...k, status: 'revoked', revoked_at: new Date().toISOString() } : k))
    } finally {
      setBusy(null)
    }
  }, [])

  const critical = alerts.filter(a => a.severity === 'critical').length

  return (
    <div className="h-full overflow-y-auto bg-gray-950">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Governance Console
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Tenancy, budgets, keys & guardrails</p>
        </div>
        {critical > 0 && (
          <span className="px-3 py-1.5 rounded-lg bg-red-900/40 border border-red-700 text-red-300 text-xs font-medium animate-pulse">
            {critical} critical alert{critical === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm">{error}</div>
      )}

      <div className="p-6 space-y-6">
        {/* Alerts feed */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Security alerts</h3>
          <div className="space-y-2 max-h-52 overflow-y-auto">
            {alerts.map((a, i) => (
              <div key={i} className={`flex items-start gap-3 px-3 py-2 rounded-lg border text-xs
                ${a.severity === 'critical' ? 'bg-red-900/20 border-red-800/60' : 'bg-yellow-900/10 border-yellow-800/40'}`}>
                <span className={a.severity === 'critical' ? 'text-red-400' : 'text-yellow-400'}>
                  {a.type === 'guardrail' ? '🛡' : a.type === 'budget' ? '💰' : '⏳'}
                </span>
                <div className="flex-1">
                  <p className={a.severity === 'critical' ? 'text-red-300 font-medium' : 'text-yellow-300 font-medium'}>{a.title}</p>
                  {a.detail && <p className="text-gray-500 mt-0.5">{a.detail}</p>}
                </div>
                <span className="text-gray-600">{new Date(a.created_at).toLocaleTimeString()}</span>
              </div>
            ))}
            {alerts.length === 0 && (
              <div className="py-6 text-center text-emerald-500/70 text-xs">✓ No active alerts — all systems within policy</div>
            )}
          </div>
        </div>

        {/* Keys with budget burn-down */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">API keys — usage & budgets</h3>
          <div className="space-y-2">
            {keys.map(k => {
              const burn = k.budget_burn_pct
              const barColor = burn >= 100 ? 'bg-red-500' : burn >= 80 ? 'bg-yellow-500' : 'bg-emerald-500'
              return (
                <div key={k.id} className="border border-gray-800 rounded-lg p-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      k.status === 'active' ? 'bg-emerald-500' : k.status === 'revoked' ? 'bg-red-500' : 'bg-gray-500'}`} />
                    <span className="text-sm text-gray-200 font-medium">{k.name}</span>
                    <span className="font-mono text-xs text-gray-500">{k.key_prefix}…</span>
                    <div className="flex gap-1">
                      {(k.scopes ?? []).map(s => (
                        <span key={s} className="px-1.5 py-0.5 bg-gray-800 rounded text-[10px] text-gray-400">{s}</span>
                      ))}
                    </div>
                    <div className="ml-auto flex items-center gap-4 text-xs">
                      <span className="text-gray-500">{k.requests} reqs</span>
                      <span className="text-emerald-400 font-mono">{fmtCost(k.cost_usd)}</span>
                      {k.status === 'active' ? (
                        <button onClick={() => revokeKey(k.id)} disabled={busy === k.id}
                          className="px-2 py-1 rounded bg-red-900/40 border border-red-800 text-red-300 hover:bg-red-800/50 transition-colors disabled:opacity-50">
                          {busy === k.id ? 'Revoking…' : 'Revoke now'}
                        </button>
                      ) : (
                        <span className="text-red-400">{k.status}</span>
                      )}
                    </div>
                  </div>
                  {k.budget_usd != null && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, burn)}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-500 font-mono w-32 text-right">
                        {fmtCost(k.cost_usd)} / {fmtCost(k.budget_usd)} ({burn.toFixed(0)}%)
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
            {keys.length === 0 && (
              <div className="py-8 text-center text-gray-600 text-xs">
                No API keys. Create one in Admin to see spend attribution here.
              </div>
            )}
          </div>
        </div>

        {/* Live attributed request stream */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live request stream
          </h3>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {recent.map(s => (
              <div key={s.session_id} className="flex items-center gap-2 text-xs py-1.5 border-b border-gray-800/40">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  s.status === 'completed' ? 'bg-emerald-500' : s.status === 'failed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${s.mode === 'machine' ? 'bg-purple-900/50 text-purple-300' : 'bg-blue-900/50 text-blue-300'}`}>
                  {s.mode}
                </span>
                <span className="text-gray-300 truncate flex-1">{shortModel(s.model)}</span>
                <span className="text-gray-500 font-mono">{s.tokens} tok</span>
                <span className="text-emerald-500/80 font-mono w-16 text-right">{fmtCost(s.cost_usd)}</span>
                <span className="text-gray-600">{new Date(s.started_at).toLocaleTimeString()}</span>
              </div>
            ))}
            {recent.length === 0 && <div className="py-6 text-center text-gray-600 text-xs">Waiting for requests…</div>}
          </div>
        </div>
      </div>
    </div>
  )
}
