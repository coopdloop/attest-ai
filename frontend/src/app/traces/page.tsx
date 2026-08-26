'use client'

import { useState, useEffect } from 'react'
import { TraceTimeline } from '@/components/trace/TraceTimeline'
import { BundleViewer } from '@/components/attestation/BundleViewer'
import type { Session, TraceEvent, AttestationBundle } from '@/types'

export default function TracesPage() {
  const [sessions, setSessions]               = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [traceEvents, setTraceEvents]         = useState<TraceEvent[]>([])
  const [bundle, setBundle]                   = useState<AttestationBundle | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError]     = useState<string | null>(null)

  useEffect(() => {
    const orgId = typeof window !== 'undefined' ? localStorage.getItem('org_id') : null
    if (!orgId) { setSessionsLoading(false); setSessionsError('Not logged in'); return }

    fetch(`/tqs/traces?org_id=${encodeURIComponent(orgId)}`)
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((data: Session[]) => setSessions(Array.isArray(data) ? data : []))
      .catch(e => setSessionsError(String(e)))
      .finally(() => setSessionsLoading(false))
  }, [])

  async function loadTrace(sessionId: string) {
    setSelectedSession(sessionId)
    setTraceEvents([])
    setBundle(null)

    const [traceResp, bundleResp] = await Promise.allSettled([
      fetch(`/tqs/traces/${sessionId}`),
      fetch(`/tqs/traces/${sessionId}/bundle`),
    ])

    if (traceResp.status === 'fulfilled' && traceResp.value.ok) {
      const data = await traceResp.value.json()
      setTraceEvents(data.entries ?? [])
    }

    if (bundleResp.status === 'fulfilled' && bundleResp.value.ok) {
      setBundle(await bundleResp.value.json())
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Session list sidebar */}
      <div className="w-72 border-r border-gray-800 overflow-y-auto shrink-0">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-sm font-semibold">Session Browser</h1>
          <p className="text-xs text-gray-500 mt-0.5">Agent session history</p>
        </div>

        {sessionsLoading && (
          <div className="p-4 text-xs text-gray-500">Loading sessions…</div>
        )}
        {sessionsError && (
          <div className="p-4 text-xs text-red-400">{sessionsError}</div>
        )}
        {!sessionsLoading && !sessionsError && sessions.length === 0 && (
          <p className="text-xs text-gray-600 p-4">No sessions yet. Send a chat message to create one.</p>
        )}
        {sessions.map(s => (
          <button
            key={s.session_id}
            onClick={() => loadTrace(s.session_id)}
            className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-900
                        ${selectedSession === s.session_id ? 'bg-gray-900' : ''}`}
          >
            <p className="text-xs font-mono text-gray-300 truncate">{s.session_id.slice(0, 16)}…</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                s.status === 'completed' ? 'bg-green-900/40 text-green-400' :
                s.status === 'failed'    ? 'bg-red-900/40 text-red-400' :
                'bg-gray-800 text-gray-400'
              }`}>{s.status}</span>
              <span className="text-xs text-gray-600">{s.mode}</span>
            </div>
            {s.started_at && (
              <p className="text-xs text-gray-700 mt-0.5">{formatDate(s.started_at)}</p>
            )}
          </button>
        ))}
      </div>

      {/* Main panel */}
      <div className="flex-1 p-6 overflow-y-auto">
        {!selectedSession ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            Select a session to view its trace
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            <TraceTimeline
              sessionId={selectedSession}
              events={traceEvents}
              integrityValid={true}
            />
            {bundle && (
              <BundleViewer bundle={bundle} sessionId={selectedSession} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
