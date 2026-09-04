'use client'

import { useEffect, useState } from 'react'
import { TraceTimeline } from '@/components/trace/TraceTimeline'
import { Conversation, type ConversationTurn } from '@/components/trace/Conversation'
import { BundleViewer } from '@/components/attestation/BundleViewer'
import type { TraceEvent, AttestationBundle, Session } from '@/types'

interface TraceDrawerProps {
  sessionId: string | null
  onClose: () => void
}

// Slide-over tray: view a session's full trace (conversation, timeline,
// attestation bundle) without leaving the current page. Used by Discover so
// browsing the activity log stays a single pane of glass.
export function TraceDrawer({ sessionId, onClose }: TraceDrawerProps) {
  const [events, setEvents]         = useState<TraceEvent[]>([])
  const [turns, setTurns]           = useState<ConversationTurn[]>([])
  const [integrityValid, setValid]  = useState(true)
  const [tamperedAtSeq, setTampered] = useState<number | undefined>(undefined)
  const [bundle, setBundle]         = useState<AttestationBundle | null>(null)
  const [session, setSession]       = useState<Session | null>(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)

  const open = sessionId !== null

  useEffect(() => {
    if (!sessionId) return
    setEvents([]); setTurns([]); setBundle(null); setSession(null)
    setValid(true); setTampered(undefined); setError(null)

    const orgId = typeof window !== 'undefined' ? localStorage.getItem('org_id') : null

    async function load() {
      setLoading(true)
      const [traceResp, convoResp, bundleResp, listResp] = await Promise.allSettled([
        fetch(`/tqs/traces/${sessionId}`),
        fetch(`/tqs/traces/${sessionId}/conversation`),
        fetch(`/tqs/traces/${sessionId}/bundle`),
        orgId ? fetch(`/tqs/traces?org_id=${encodeURIComponent(orgId)}`) : Promise.reject('no org'),
      ])

      if (traceResp.status === 'fulfilled' && traceResp.value.ok) {
        const data = await traceResp.value.json()
        setEvents(data.entries ?? [])
        setValid(data.integrity?.valid ?? true)
        setTampered(data.integrity?.tampered_at_seq >= 0 ? data.integrity.tampered_at_seq : undefined)
      } else {
        setError('Trace not found')
      }

      if (convoResp.status === 'fulfilled' && convoResp.value.ok) {
        const data = await convoResp.value.json()
        setTurns(data.turns ?? [])
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

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function formatDate(iso?: string) {
    return iso ? new Date(iso).toLocaleString() : '—'
  }

  return (
    <div
      className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Panel */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-2xl bg-gray-950 border-l border-gray-800
                    shadow-2xl transition-transform duration-200 ease-out flex flex-col
                    ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {sessionId && (
          <>
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div className="min-w-0">
                <p className="text-xs text-gray-500">Session</p>
                <p className="text-sm font-mono text-gray-300 truncate">{sessionId}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <a
                  href={`/traces/${sessionId}`}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
                >
                  full page ↗
                </a>
                <button
                  onClick={onClose}
                  title="Close"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-100 hover:bg-gray-800 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {loading && <div className="text-sm text-gray-500">Loading trace…</div>}
              {error && <div className="text-sm text-red-400">{error}</div>}

              {!loading && !error && (
                <>
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-semibold text-gray-300">Session Detail</h2>
                      {session && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          session.status === 'completed' ? 'bg-green-900/40 text-green-400' :
                          session.status === 'failed'    ? 'bg-red-900/40 text-red-400' :
                          'bg-gray-800 text-gray-400'
                        }`}>{session.status}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
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

                  <Conversation turns={turns} />

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
