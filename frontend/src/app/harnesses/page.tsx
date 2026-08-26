'use client'

import { useState, useEffect, useCallback } from 'react'
import type { HarnessDefinition } from '@/types'

interface HarnessRecord {
  id: string
  name: string
  slug: string
  description?: string
  version: string
  is_built_in: boolean
}

function getOrgId() {
  return typeof window !== 'undefined' ? (localStorage.getItem('org_id') ?? '') : ''
}

export default function HarnessStudioPage() {
  const [harnesses, setHarnesses] = useState<HarnessRecord[]>([])
  const [editing, setEditing]     = useState<HarnessDefinition | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const fetchHarnesses = useCallback(async () => {
    const orgId = getOrgId()
    if (!orgId) { setLoading(false); setError('Not logged in'); return }
    setLoading(true)
    try {
      const r = await fetch(`/ctx/harnesses?org_id=${encodeURIComponent(orgId)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setHarnesses(Array.isArray(data) ? data : [])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchHarnesses() }, [fetchHarnesses])

  async function saveHarness(draft: HarnessDefinition) {
    const orgId = getOrgId()
    if (!orgId) return
    const body = {
      name: draft.name,
      slug: draft.slug,
      definition: {
        name: draft.name,
        slug: draft.slug,
        description: draft.description,
        version: draft.version,
        is_built_in: false,
        system_context: draft.system_context,
        roe_scope: draft.roe_scope,
        guardrails: draft.guardrails,
        tool_bindings: draft.tool_bindings,
        model_bindings: draft.model_bindings,
        attestation_policy: draft.attestation_policy,
      },
    }
    const r = await fetch(`/ctx/harnesses?org_id=${encodeURIComponent(orgId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (r.ok) { setEditing(null); fetchHarnesses() }
    else alert(`Save failed: HTTP ${r.status}`)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold">Harness Studio</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Create and version agent harness definitions
            </p>
          </div>
          <button
            onClick={() => setEditing({
              name: 'New Harness',
              slug: 'new-harness',
              version: '0.1.0',
              is_built_in: false,
              system_context: '',
              roe_scope: {},
              guardrails: [],
              tool_bindings: [],
              model_bindings: { primary: 'openrouter/ox-alpha' },
              attestation_policy: { sign_fields: [], retain_fields: [], redact_fields: [] },
            })}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            + New Harness
          </button>
        </div>

        {loading && <div className="text-sm text-gray-500 py-8 text-center">Loading harnesses…</div>}
        {error && <div className="text-sm text-red-400 py-4">{error}</div>}

        {/* Harness list */}
        <div className="grid gap-3">
          {!loading && !error && harnesses.length === 0 && (
            <div className="text-center text-gray-600 py-12 border border-dashed border-gray-800 rounded-xl">
              <p className="text-sm">No harnesses yet.</p>
              <p className="text-xs mt-1">Create one above to define agent behavior and tool access.</p>
            </div>
          )}
          {harnesses.map((h) => (
            <HarnessCard key={h.slug} harness={h} onEdit={() => setEditing({
              name: h.name,
              slug: h.slug,
              description: h.description,
              version: h.version,
              is_built_in: h.is_built_in,
              system_context: '',
              roe_scope: {},
              guardrails: [],
              tool_bindings: [],
              model_bindings: { primary: 'openrouter/ox-alpha' },
              attestation_policy: { sign_fields: [], retain_fields: [], redact_fields: [] },
            })} />
          ))}
        </div>

        {/* Editor modal */}
        {editing && (
          <HarnessEditor harness={editing} onClose={() => setEditing(null)} onSave={saveHarness} />
        )}
      </div>
    </div>
  )
}

function HarnessCard({ harness, onEdit }: { harness: HarnessRecord; onEdit: () => void }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{harness.name}</span>
          {harness.is_built_in && (
            <span className="text-xs px-1.5 py-0.5 bg-blue-900 text-blue-300 rounded">built-in</span>
          )}
          <span className="text-xs text-gray-500">v{harness.version}</span>
        </div>
        {harness.description && (
          <p className="text-xs text-gray-500 mt-0.5">{harness.description}</p>
        )}
        <p className="text-xs text-gray-600 mt-1 font-mono">{harness.slug}</p>
      </div>
      <button
        onClick={onEdit}
        className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5 rounded-lg
                   border border-gray-700 hover:border-gray-500 transition-colors"
      >
        Edit
      </button>
    </div>
  )
}

function HarnessEditor({ harness, onClose, onSave }: {
  harness: HarnessDefinition
  onClose: () => void
  onSave: (draft: HarnessDefinition) => Promise<void>
}) {
  const [draft, setDraft] = useState(harness)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try { await onSave(draft) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{draft.name}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-200">✕</button>
        </div>

        <div className="p-6 space-y-4 text-sm">
          <Field label="Name">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
              value={draft.name}
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label="Slug">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono"
              value={draft.slug}
              onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))}
            />
          </Field>
          <Field label="System Context">
            <textarea
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono h-40 resize-none"
              value={draft.system_context}
              onChange={e => setDraft(d => ({ ...d, system_context: e.target.value }))}
            />
          </Field>
          <Field label="Primary Model">
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm font-mono"
              value={draft.model_bindings.primary}
              onChange={e => setDraft(d => ({
                ...d,
                model_bindings: { ...d.model_bindings, primary: e.target.value }
              }))}
            />
          </Field>
        </div>

        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-700 px-6 py-4 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-400 hover:text-gray-200 px-4 py-2">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? 'Saving…' : 'Save Harness'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  )
}
