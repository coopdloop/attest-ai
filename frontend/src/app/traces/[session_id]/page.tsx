'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TraceTimeline } from '@/components/trace/TraceTimeline'
import { BundleViewer } from '@/components/attestation/BundleViewer'
import type { TraceEvent, AttestationBundle, Session } from '@/types'

export default function TraceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const sessionId = String(params.session_id)

  const [events, setEvents]           = useState<TraceEvent[]>([])
  const [integrityValid, setValid]    = useState(true)
  const [tamperedAtSeq, setTampered]  = useState<number | undefined>(undefined)
  const [bundle, setBundle]           = useState<AttestationBundle | null>(null)
  const [session, setSession]         = useState<Session | null>(null)
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  useEffect(() => {
    const orgId = typeof window !== 'undefined' ? localStorage.getItem('org_id') : null

    async function load() {
      setLoading(true)
      const [traceResp, bundleResp, listResp] = await Promise.allSettled([
        fetch(`/tqs/traces/${sessionId}`),
        fetch(`/tqs/traces/${sessionId}/bundle`),
        orgId ? fetch(`/tqs/traces?org_id=${encodeURIComponent(orgId)}`) : Promise.reject('no org'),
      ])

      if (traceResp.status === 'fulfilled' && traceResp.value.ok) {
        const data = await traceResp.value.json()
        setEvents(data.entries ?? [])
        setValid(data.integrity?.valid ?? true)
        setTampered(
          data.integrity?.tampered_at_seq >= 0 ? data.integrity.tampered_at_seq : undefined
        )
      } else {
        setError('Trace not found')
      }

      if (bundleResp.status === 'fulfilled' && bundleResp.value.ok) {
        setBundle(await bundleResp.value.json())
      }

      if (listResp.status === 'fulfilled' && listResp.value.ok) {
        const sessions: Session[] = await listResp.value.json()
        setSession(sessions.find(s => s.session_id === sessionId) ?? null)
      }

      setLoading(false)
    }
    load()
  }, [sessionId])

  function formatDate(iso?: string) {
    return iso ? new Date(iso).toLocaleString() : '—'
  }

  return (
    <div className="h-screen overflow-y-auto bg-gray-950 text-gray-100">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        {/* Breadcrumb + actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <button onClick={() => router.push('/traces')} className="hover:text-gray-300 transition-colors">
              Traces
            </button>
            <span>/</span>
            <span className="font-mono text-gray-400">{sessionId.slice(0, 16)}…</span>
          </div>
          <div className="flex items-center gap-3">
            <a
              href={`/chat?session=${sessionId}`}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
            >
              ↩ Open chat session
            </a>
            <a
              href={`/tqs/traces/${sessionId}/export`}
              download
              className="text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ Export
            </a>
          </div>
        </div>

        {loading && <div className="text-sm text-gray-500">Loading trace…</div>}
        {error && <div className="text-sm text-red-400">{error}</div>}

        {!loading && !error && (
          <>
            {/* Session detail */}
            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h1 className="text-sm font-semibold text-gray-300">Session Detail</h1>
                {session && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    session.status === 'completed' ? 'bg-green-900/40 text-green-400' :
                    session.status === 'failed'    ? 'bg-red-900/40 text-red-400' :
                    'bg-gray-800 text-gray-400'
                  }`}>{session.status}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <Detail label="Session ID" value={sessionId} mono />
                <Detail label="Mode" value={session?.mode ?? '—'} />
                <Detail label="Started" value={formatDate(session?.started_at)} />
                <Detail label="Completed" value={formatDate(session?.completed_at)} />
                <Detail label="Events" value={String(events.length)} />
                <Detail
                  label="Chain integrity"
                  value={integrityValid ? '✓ intact' : `⚠ tampered @ seq ${tamperedAtSeq}`}
                  className={integrityValid ? 'text-emerald-400' : 'text-red-400'}
                />
                <Detail
                  label="Signature"
                  value={bundle ? (bundle.signature_valid ? '✓ valid' : '✗ invalid') : 'no bundle'}
                  className={bundle?.signature_valid ? 'text-emerald-400' : bundle ? 'text-red-400' : 'text-gray-500'}
                />
                <Detail label="Agent" value={session?.agent_id ?? '—'} mono />
              </div>
            </div>

            <TraceTimeline
              sessionId={sessionId}
              events={events}
              integrityValid={integrityValid}
              tamperedAtSeq={tamperedAtSeq}
            />

            {bundle ? (
              <BundleViewer bundle={bundle} sessionId={sessionId} />
            ) : (
              <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 text-xs text-gray-500">
                No signed attestation bundle for this session. Bundles are created when a
                session is finalized — older sessions created before finalization was wired
                up will not have one.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Detail({ label, value, mono, className }: {
  label: string; value: string; mono?: boolean; className?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-gray-600 uppercase tracking-wide text-[10px]">{label}</span>
      <span className={`break-all ${mono ? 'font-mono text-gray-400' : 'text-gray-300'} ${className ?? ''}`}>
        {value}
      </span>
    </div>
  )
}
