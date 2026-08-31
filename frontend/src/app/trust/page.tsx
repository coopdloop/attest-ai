'use client'

import { useEffect, useState, useCallback } from 'react'
import { trust, type TrustScoreResp, type VerifyResult, type AuditEntry } from '@/lib/api'
import { Gauge } from '@/components/charts/Charts'

export default function TrustPage() {
  const [score, setScore] = useState<TrustScoreResp | null>(null)
  const [results, setResults] = useState<VerifyResult[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [stats, setStats] = useState<{ checked: number; verified: number; sigFails: number; chainFails: number } | null>(null)
  const [sweeping, setSweeping] = useState(false)
  const [sweepIdx, setSweepIdx] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const loadScore = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([trust.score('30d'), trust.auditLog(60)])
      setScore(s)
      setAudit(a.entries)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trust data')
    }
  }, [])

  useEffect(() => { loadScore() }, [loadScore])

  const runSweep = useCallback(async () => {
    setSweeping(true)
    setSweepIdx(0)
    try {
      const batch = await trust.verifyBatch(60)
      setStats({ checked: batch.checked, verified: batch.verified, sigFails: batch.signature_fails, chainFails: batch.chain_fails })
      // Animate the reveal so the wall "sweeps" through verified bundles.
      setResults([])
      for (let i = 0; i < batch.results.length; i++) {
        setResults(prev => [...prev, batch.results[i]])
        setSweepIdx(i + 1)
        await new Promise(r => setTimeout(r, 40))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setSweeping(false)
    }
  }, [])

  useEffect(() => { runSweep() }, [runSweep])

  const allValid = stats ? stats.sigFails === 0 && stats.chainFails === 0 : true

  return (
    <div className="h-full overflow-y-auto bg-gray-950">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between sticky top-0 bg-gray-950/95 backdrop-blur z-10">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Trust Center
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Org-wide cryptographic attestation & verification</p>
        </div>
        <button onClick={runSweep} disabled={sweeping}
          className="px-4 py-2 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-2">
          {sweeping ? (
            <><svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
            Verifying {sweepIdx}/{stats?.checked ?? '…'}</>
          ) : 'Re-verify all'}
        </button>
      </div>

      {error && (
        <div className="mx-6 mt-4 px-4 py-3 bg-red-900/30 border border-red-800 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="p-6 space-y-6">
        {/* Hero: trust score gauge + KPIs */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`bg-gray-900 border rounded-xl p-6 flex flex-col items-center justify-center
                          ${allValid ? 'border-emerald-800/60' : 'border-red-800/60'}`}>
            <Gauge pct={stats ? (stats.checked ? (stats.verified / stats.checked) * 100 : 100) : (score?.coverage_pct ?? 0)}
                   label="verified bundles" size={220} />
            <p className={`mt-2 text-sm font-semibold ${allValid ? 'text-emerald-400' : 'text-red-400'}`}>
              {allValid ? '✓ All signatures & chains intact' : '⚠ Integrity failures detected'}
            </p>
          </div>

          <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3">
            <TrustKpi label="Signed bundles" value={score ? String(score.signed_bundles) : '—'} accent="text-emerald-400" />
            <TrustKpi label="Coverage" value={score ? `${score.coverage_pct.toFixed(0)}%` : '—'} />
            <TrustKpi label="Signing events" value={score ? String(score.signing_events) : '—'} />
            <TrustKpi label="Completed sessions" value={score ? String(score.completed_sessions) : '—'} />
            <TrustKpi label="Checked now" value={stats ? String(stats.checked) : '—'} />
            <TrustKpi label="Verified" value={stats ? String(stats.verified) : '—'} accent="text-emerald-400" />
            <TrustKpi label="Signature fails" value={stats ? String(stats.sigFails) : '—'}
                      accent={stats && stats.sigFails > 0 ? 'text-red-400' : 'text-gray-100'} />
            <TrustKpi label="Chain fails" value={stats ? String(stats.chainFails) : '—'}
                      accent={stats && stats.chainFails > 0 ? 'text-red-400' : 'text-gray-100'} />
          </div>
        </div>

        {/* Verification wall */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              Verification wall {sweeping && <span className="text-emerald-400 ml-2">sweeping…</span>}
            </h3>
            <span className="text-xs text-gray-600">{results.length} bundles</span>
          </div>
          <div className="grid grid-cols-10 sm:grid-cols-12 lg:grid-cols-16 gap-1.5">
            {results.map(r => (
              <a key={r.session_id} href={`/traces/${r.session_id}`}
                 title={`${r.model_id || 'unknown'} · ${r.event_count} events · ${r.verified ? 'verified' : 'FAILED'}`}
                 className={`aspect-square rounded-md border transition-transform hover:scale-110 flex items-center justify-center
                           ${r.verified ? 'bg-emerald-500/15 border-emerald-600/50 hover:border-emerald-400'
                                        : 'bg-red-500/20 border-red-600 animate-pulse'}`}>
                <span className="text-[9px]">{r.verified ? '✓' : '✕'}</span>
              </a>
            ))}
            {results.length === 0 && !sweeping && (
              <div className="col-span-full py-8 text-center text-gray-600 text-xs">
                No attestation bundles yet. Complete a chat session to generate signed receipts.
              </div>
            )}
          </div>
        </div>

        {/* Recent verified sessions + audit log */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Signed sessions</h3>
            <div className="space-y-1 max-h-[320px] overflow-y-auto">
              {results.map(r => (
                <div key={r.session_id} className="flex items-center gap-2 text-xs py-2 border-b border-gray-800/40">
                  <span className={r.verified ? 'text-emerald-400' : 'text-red-400'}>{r.verified ? '✓' : '✕'}</span>
                  <a href={`/verify/${r.session_id}`} className="font-mono text-gray-400 hover:text-blue-400 truncate w-32">
                    {r.session_id.slice(0, 12)}…
                  </a>
                  <span className="text-gray-500 truncate flex-1">{(r.model_id || 'unknown').replace(/^openrouter\//, '')}</span>
                  <span className="text-gray-600">{r.event_count} evt</span>
                  <span className="font-mono text-gray-700 w-20 truncate" title={r.root_hash}>{r.root_hash.slice(0, 8)}…</span>
                </div>
              ))}
              {results.length === 0 && <div className="py-6 text-center text-gray-600 text-xs">No signed sessions</div>}
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Signing audit log</h3>
            <div className="space-y-1 max-h-[320px] overflow-y-auto">
              {audit.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs py-2 border-b border-gray-800/40">
                  <span className="text-emerald-500">⛓</span>
                  <span className="font-mono text-gray-500 w-24 truncate" title={e.key_id}>{e.key_id.slice(0, 16)}…</span>
                  <span className="text-gray-400 flex-1 truncate">{e.caller_service}</span>
                  <span className="font-mono text-gray-700 w-20 truncate" title={e.digest}>{e.digest.slice(0, 8)}…</span>
                  <span className="text-gray-600">{new Date(e.signed_at).toLocaleTimeString()}</span>
                </div>
              ))}
              {audit.length === 0 && <div className="py-6 text-center text-gray-600 text-xs">No signing events</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrustKpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ?? 'text-gray-100'}`}>{value}</p>
    </div>
  )
}
