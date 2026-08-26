'use client'

import { useState, useRef, useEffect } from 'react'

export interface OpenRouterModel {
  id: string           // e.g. "anthropic/claude-sonnet-4-6"
  name: string
  context_length: number
  pricing: { prompt: string; completion: string }
}

function toOrId(id: string) {
  // prefix with "openrouter/" for our backend
  return id.startsWith('openrouter/') ? id : `openrouter/${id}`
}

function stripOr(id: string) {
  return id.startsWith('openrouter/') ? id.slice('openrouter/'.length) : id
}

function provider(id: string) {
  return stripOr(id).split('/')[0] ?? 'unknown'
}

function formatPrice(p: string) {
  const n = parseFloat(p)
  if (!n) return 'free'
  if (n < 0.000001) return `$${(n * 1e6).toFixed(2)}/M`
  return `$${(n * 1e6).toFixed(2)}/M`
}

const PROVIDER_COLORS: Record<string, string> = {
  'anthropic':   'text-orange-400',
  'openai':      'text-green-400',
  'deepseek':    'text-blue-400',
  'meta-llama':  'text-blue-300',
  'google':      'text-yellow-400',
  'mistralai':   'text-red-400',
  'x-ai':        'text-purple-400',
  'cohere':      'text-teal-400',
  'perplexity':  'text-cyan-400',
}

function providerColor(id: string) {
  const p = provider(id)
  return PROVIDER_COLORS[p] ?? 'text-gray-400'
}

interface Props {
  value: string
  onChange: (model: string) => void
}

// Module-level cache so ChatWindow can look up context_length without re-fetching
export let cachedModels: OpenRouterModel[] = []

export function ModelSelector({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<OpenRouterModel[]>(cachedModels)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fetch models from OpenRouter on first open
  useEffect(() => {
    if (!open || models.length > 0) return
    setLoading(true)
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(data => {
        const sorted = (data?.data ?? []) as OpenRouterModel[]
        sorted.sort((a, b) => a.name.localeCompare(b.name))
        cachedModels = sorted
        setModels(sorted)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [open, models.length])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = models.filter(m =>
    !search || m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.id.toLowerCase().includes(search.toLowerCase())
  )

  // Group by provider
  const grouped = filtered.reduce<Record<string, OpenRouterModel[]>>((acc, m) => {
    const p = provider(m.id)
    ;(acc[p] ??= []).push(m)
    return acc
  }, {})

  const currentId = stripOr(value)
  const current = models.find(m => m.id === currentId)
  const displayLabel = current?.name ?? stripOr(value).split('/').pop() ?? value

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700
                   border border-gray-700 text-sm text-gray-200 transition-colors max-w-[260px]"
      >
        <span className={`text-xs font-medium shrink-0 ${providerColor(value)}`}>
          {provider(value)}
        </span>
        <span className="truncate text-left">{displayLabel}</span>
        <svg className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-96 bg-gray-900 border border-gray-700
                        rounded-xl shadow-2xl flex flex-col overflow-hidden max-h-[480px]">
          {/* Search */}
          <div className="px-3 py-2.5 border-b border-gray-800">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search models…"
              className="w-full bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-200
                         placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-gray-600"
            />
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {loading && (
              <div className="flex items-center justify-center py-8 text-sm text-gray-500">
                Loading models…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="py-8 text-center text-sm text-gray-500">No models found</div>
            )}
            {!loading && Object.entries(grouped).map(([prov, ms]) => (
              <div key={prov}>
                <div className={`sticky top-0 px-3 py-1.5 text-xs font-semibold bg-gray-900/95
                                 backdrop-blur ${PROVIDER_COLORS[prov] ?? 'text-gray-400'}`}>
                  {prov}
                </div>
                {ms.map(m => {
                  const selected = toOrId(m.id) === value
                  return (
                    <button
                      key={m.id}
                      onClick={() => { onChange(toOrId(m.id)); setOpen(false); setSearch('') }}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-800 transition-colors
                                  flex items-center justify-between gap-3
                                  ${selected ? 'bg-gray-800' : ''}`}
                    >
                      <div className="min-w-0">
                        <div className={`text-sm truncate ${selected ? 'text-white' : 'text-gray-300'}`}>
                          {m.name}
                          {selected && <span className="ml-1.5 text-xs text-blue-400">✓</span>}
                        </div>
                        <div className="text-xs text-gray-600 truncate">{m.id}</div>
                      </div>
                      {m.pricing && (
                        <div className="text-right shrink-0">
                          <div className="text-xs text-gray-500">{formatPrice(m.pricing.prompt)} in</div>
                          <div className="text-xs text-gray-500">{formatPrice(m.pricing.completion)} out</div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
