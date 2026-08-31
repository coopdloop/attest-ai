'use client'

import { use, useEffect, useState } from 'react'
import { trust, type PublicVerifyResp } from '@/lib/api'

export default function VerifyReceiptPage({ params }: { params: Promise<{ session_id: string }> }) {
  const { session_id } = use(params)
  const [data, setData] = useState<PublicVerifyResp | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    trust.publicVerify(session_id)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [session_id])

  const verified = data?.verified ?? false

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-xs font-bold">A</div>
          <span className="font-semibold">attest-ai</span>
          <span className="text-gray-600 text-sm">· public receipt</span>
        </div>

        {loading ? (
          <div className="text-center text-gray-500 py-20">Verifying signature…</div>
        ) : !data || data.error ? (
          <div className="bg-gray-900 border border-red-800/60 rounded-2xl p-8 text-center">
            <div className="text-4xl mb-3">✕</div>
            <h1 className="text-lg font-semibold text-red-400">No attestation found</h1>
            <p className="text-sm text-gray-500 mt-2">{data?.error ?? 'This session has no signed bundle.'}</p>
          </div>
        ) : (
          <div className={`bg-gray-900 border rounded-2xl overflow-hidden ${verified ? 'border-emerald-700/60' : 'border-red-700/60'}`}>
            <div className={`px-8 py-8 text-center ${verified ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
              <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl mb-3
                              ${verified ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                {verified ? '✓' : '✕'}
              </div>
              <h1 className={`text-xl font-bold ${verified ? 'text-emerald-400' : 'text-red-400'}`}>
                {verified ? 'Cryptographically Verified' : 'Verification Failed'}
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                {verified
                  ? 'This AI session was signed and its hash chain is intact.'
                  : 'The signature or hash chain did not validate.'}
              </p>
            </div>

            <div className="p-6 space-y-3">
              <Check ok={data.signature_valid} label="Ed25519 signature" />
              <Check ok={data.chain_valid} label="Hash-chain integrity" />
              <div className="border-t border-gray-800 pt-3 grid grid-cols-1 gap-2 text-xs">
                <Row label="Session" value={data.session_id} mono />
                <Row label="Model" value={(data.model_id || 'unknown').replace(/^openrouter\//, '')} />
                <Row label="Events signed" value={String(data.event_count)} />
                <Row label="Signing key" value={data.signing_key_id} mono />
                <Row label="Root hash" value={data.root_hash} mono />
                <Row label="Algorithm" value={data.algorithm} />
                <Row label="Signed at" value={new Date(data.signed_at).toLocaleString()} />
                <Row label="Verified at" value={new Date(data.verified_at).toLocaleString()} />
              </div>
            </div>

            <div className="px-6 py-3 border-t border-gray-800 text-center">
              <p className="text-[11px] text-gray-600">
                Anyone can verify this receipt — no login required. Validated against the org public key.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs
                       ${ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
        {ok ? '✓' : '✕'}
      </span>
      <span className={`text-sm ${ok ? 'text-gray-200' : 'text-red-300'}`}>{label}</span>
      <span className={`ml-auto text-xs ${ok ? 'text-emerald-500' : 'text-red-500'}`}>{ok ? 'valid' : 'invalid'}</span>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="text-gray-600 w-28 shrink-0">{label}</span>
      <span className={`text-gray-300 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}
