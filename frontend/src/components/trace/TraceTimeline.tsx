'use client'

import type { TraceEvent, TraceEventType } from '@/types'

interface TraceTimelineProps {
  sessionId: string
  events: TraceEvent[]
  integrityValid: boolean
  tamperedAtSeq?: number
}

const EVENT_COLORS: Record<TraceEventType, string> = {
  reasoning_step: 'bg-blue-500',
  tool_call: 'bg-yellow-500',
  tool_response: 'bg-green-500',
  model_swap: 'bg-purple-500',
  retry: 'bg-orange-500',
  completion: 'bg-emerald-500',
  error: 'bg-red-500',
  policy_violation: 'bg-rose-600',
}

const EVENT_ICONS: Record<TraceEventType, string> = {
  reasoning_step: '🧠',
  tool_call: '🔧',
  tool_response: '📦',
  model_swap: '🔄',
  retry: '↩️',
  completion: '✅',
  error: '❌',
  policy_violation: '🛡️',
}

export function TraceTimeline({ sessionId, events, integrityValid, tamperedAtSeq }: TraceTimelineProps) {
  return (
    <div className="bg-gray-950 text-gray-100 p-4 rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-300">Trace Timeline</h2>
          <p className="text-xs text-gray-500 font-mono">{sessionId}</p>
        </div>
        <IntegrityBadge valid={integrityValid} tamperedAtSeq={tamperedAtSeq} />
      </div>

      {/* Waterfall */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-800" />

        <div className="space-y-2">
          {events.map((event, i) => (
            <TraceEventRow
              key={event.id}
              event={event}
              isTampered={tamperedAtSeq !== undefined && event.seq >= tamperedAtSeq}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function TraceEventRow({ event, isTampered }: { event: TraceEvent; isTampered: boolean }) {
  const color = EVENT_COLORS[event.event_type] ?? 'bg-gray-500'
  const icon = EVENT_ICONS[event.event_type] ?? '•'

  return (
    <div className={`relative flex items-start gap-3 pl-8 ${isTampered ? 'opacity-50 line-through' : ''}`}>
      {/* Dot on timeline */}
      <div className={`absolute left-2.5 w-3 h-3 rounded-full border-2 border-gray-950 ${color} flex-shrink-0 mt-1`} />

      {/* Event card */}
      <div className="flex-1 bg-gray-900 border border-gray-800 rounded-lg p-3 hover:border-gray-600 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs">{icon}</span>
            <span className="text-xs font-medium text-gray-200 capitalize">
              {event.event_type.replace(/_/g, ' ')}
            </span>
            <span className="text-xs text-gray-600">seq:{event.seq}</span>
          </div>
          <span className="text-xs text-gray-600 font-mono">
            {new Date(event.created_at).toLocaleTimeString()}
          </span>
        </div>

        {/* Payload preview */}
        {event.payload && (
          <div className="mt-2 text-xs text-gray-400 font-mono bg-gray-950 rounded p-2 max-h-32 overflow-y-auto">
            {JSON.stringify(event.payload, null, 2)}
          </div>
        )}

        {/* Hash chain info */}
        <div className="mt-2 flex gap-3 text-xs text-gray-600 font-mono">
          <span title="Chain hash">⛓ {event.chain_hash.slice(0, 16)}…</span>
        </div>
      </div>
    </div>
  )
}

function IntegrityBadge({ valid, tamperedAtSeq }: { valid: boolean; tamperedAtSeq?: number }) {
  if (valid) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium
                       bg-emerald-900 text-emerald-300 border border-emerald-700 rounded-full">
        ✓ Chain intact
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium
                     bg-red-900 text-red-300 border border-red-700 rounded-full">
      ⚠ Tampered at seq:{tamperedAtSeq}
    </span>
  )
}
