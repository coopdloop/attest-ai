'use client'

import type { AttestationBundle } from '@/types'
import { TRACE_QUERY_URL } from '@/lib/api'

interface BundleViewerProps {
  bundle: AttestationBundle
  sessionId: string
}

export function BundleViewer({ bundle, sessionId }: BundleViewerProps) {
  return (
    <div className="bg-gray-950 text-gray-100 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Attestation Bundle</h3>
          <p className="text-xs text-gray-500 font-mono">{bundle.session_id}</p>
        </div>
        <SignatureBadge valid={bundle.signature_valid} />
      </div>

      {/* Fields */}
      <div className="p-4 space-y-3 text-sm">
        <Field label="Root Hash" value={bundle.root_hash} mono />
        <Field label="Signature" value={bundle.signature} mono truncate />
        <Field label="Signing Key ID" value={bundle.signing_key_id} mono />
        <Field label="Model ID" value={bundle.model_id ?? 'unknown'} />
        <Field label="Policy Version" value={bundle.policy_version ?? 'none'} />
        <Field label="Event Count" value={String(bundle.event_count)} />
        <Field label="Created" value={new Date(bundle.created_at).toLocaleString()} />
        {bundle.rekor_log_id && (
          <Field label="Rekor Log ID" value={bundle.rekor_log_id} mono />
        )}
      </div>

      {/* Export button */}
      <div className="px-4 py-3 border-t border-gray-800">
        <a
          href={`${TRACE_QUERY_URL}/traces/${sessionId}/export`}
          download={`attest-ai-bundle-${sessionId}.json`}
          className="inline-flex items-center gap-1.5 text-xs font-medium
                     bg-gray-800 hover:bg-gray-700 text-gray-200
                     px-3 py-1.5 rounded-lg transition-colors"
        >
          ↓ Export Bundle + Trace
        </a>
      </div>
    </div>
  )
}

function Field({ label, value, mono, truncate }: {
  label: string
  value: string
  mono?: boolean
  truncate?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className={`text-xs break-all ${mono ? 'font-mono text-gray-300' : 'text-gray-200'}
                        ${truncate ? 'truncate' : ''}`}>
        {value}
      </span>
    </div>
  )
}

function SignatureBadge({ valid }: { valid?: boolean }) {
  if (valid === undefined) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
        unverified
      </span>
    )
  }
  return valid ? (
    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900 text-emerald-300">
      ✓ Sig valid
    </span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full bg-red-900 text-red-300">
      ✗ Sig invalid
    </span>
  )
}
