'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ModelSelector } from './ModelSelector'

const DEFAULT_MODEL = 'openrouter/ox-alpha'
const STORAGE_KEY = 'attest-ai:conversations'

interface StoredConvo {
  id: string
  title: string
  createdAt: string
}

const TEMPLATES = [
  { title: 'Scan a domain', prompt: 'Scan example.com for open ports and summarize the exposure.', icon: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z' },
  { title: 'Analyze an IP', prompt: 'Analyze the suspicious IP 185.220.101.1 — reputation, geolocation, and known activity.', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
  { title: 'Explain a CVE', prompt: 'Explain CVE-2024-3094 (the xz backdoor): what it is, impact, and remediation.', icon: 'M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { title: 'Threat model', prompt: 'Draft a STRIDE threat model for a typical web app with a login, an API, and a Postgres database.', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
]

export function ChatStarter({ onStart }: { onStart: (text: string, model: string) => void }) {
  const router = useRouter()
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [input, setInput] = useState('')
  const [recent, setRecent] = useState<StoredConvo[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as StoredConvo[]
        if (Array.isArray(parsed)) setRecent(parsed.slice(0, 5))
      }
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  function submit() {
    if (!input.trim()) return
    onStart(input.trim(), model)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="relative flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Ambient accent */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      {/* Centered starter */}
      <main className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center justify-center px-4 py-10">
          <div className="w-14 h-14 bg-blue-600/20 rounded-2xl flex items-center justify-center mb-5">
            <div className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center text-lg font-bold">A</div>
          </div>
          <h1 className="text-2xl font-semibold text-gray-100 mb-1.5">What can I help you verify?</h1>
          <p className="text-sm text-gray-500 mb-7 text-center">
            Every response is cryptographically signed and traceable.
          </p>

          {/* Input */}
          <div className="w-full">
            <div className="mb-2 flex items-center justify-between">
              <ModelSelector value={model} onChange={setModel} />
            </div>
            <div className="relative flex items-end gap-2 bg-gray-800 border border-gray-700
                            rounded-2xl px-4 py-3 focus-within:border-gray-500 transition-colors">
              <textarea
                ref={textareaRef}
                rows={1}
                autoFocus
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message attest-ai… (Enter ↵ to send)"
                className="flex-1 bg-transparent resize-none text-sm text-gray-100
                           placeholder-gray-600 focus:outline-none min-h-[24px] max-h-[200px] leading-6"
              />
              <button
                onClick={submit}
                disabled={!input.trim()}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg
                           bg-blue-600 hover:bg-blue-500 disabled:opacity-30
                           disabled:cursor-not-allowed transition-colors"
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Templates */}
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
            {TEMPLATES.map(t => (
              <button
                key={t.title}
                onClick={() => onStart(t.prompt, model)}
                className="group flex items-start gap-3 text-left px-4 py-3 rounded-xl bg-gray-900
                           hover:bg-gray-800 border border-gray-800 hover:border-gray-700 transition-colors"
              >
                <span className="mt-0.5 text-gray-500 group-hover:text-blue-400 transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={t.icon} />
                  </svg>
                </span>
                <span>
                  <span className="block text-sm text-gray-200 font-medium">{t.title}</span>
                  <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{t.prompt}</span>
                </span>
              </button>
            ))}
          </div>

          {/* Recent chats */}
          {recent.length > 0 && (
            <div className="mt-8 w-full">
              <p className="text-xs text-gray-600 uppercase tracking-wide mb-2">Recent</p>
              <div className="space-y-1">
                {recent.map(c => (
                  <button
                    key={c.id}
                    onClick={() => router.push(`/chat/${c.id}`)}
                    className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm
                               text-gray-400 hover:bg-gray-900 hover:text-gray-200 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5 text-gray-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.8L3 20l1.3-3.9A7.96 7.96 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <span className="truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
