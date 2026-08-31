'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const FEATURES = [
  {
    title: 'Cryptographic attestation',
    body: 'Every session is sealed into an Ed25519-signed, hash-chained trace anyone can verify.',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
  {
    title: 'Glass-box traces',
    body: 'Reasoning steps, tool calls, and model choices — captured, timestamped, and tamper-evident.',
    icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z',
  },
  {
    title: 'OpenAI-compatible',
    body: 'Point any OpenAI client at one base URL. LangChain, CrewAI, curl, the SDK — all just work.',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    title: '400+ models',
    body: 'One key, every model via OpenRouter — including free-tier and frontier reasoning models.',
    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  },
]

export default function LandingPage() {
  const router = useRouter()

  // Logged-in users skip the marketing page and go straight to the app.
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) return
    fetch('/auth/tokens/introspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(data => { if (data?.active) router.replace('/chat') })
      .catch(() => {})
  }, [router])

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-950 text-gray-100">
      {/* Ambient gradient accents */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[36rem] w-[36rem] rounded-full
                        bg-indigo-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -left-24 h-80 w-80 rounded-full bg-violet-600/15 blur-[100px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-blue-600/15 blur-[100px]" />
      </div>

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <a href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br
                           from-indigo-500 to-violet-600 text-sm font-bold text-white shadow-lg shadow-indigo-900/40">
            A
          </span>
          <span className="text-sm font-semibold tracking-tight">attest-ai</span>
        </a>

        <nav className="flex items-center gap-2 sm:gap-4">
          <a
            href="/docs"
            className="hidden rounded-lg px-3 py-2 text-sm text-gray-400 transition-colors
                       hover:text-gray-100 sm:inline-block"
          >
            Docs
          </a>
          <a
            href="/login"
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium
                       text-gray-100 backdrop-blur transition-colors hover:bg-white/10"
          >
            Log in
          </a>
        </nav>
      </header>

      {/* Hero */}
      <main className="relative z-10 mx-auto max-w-6xl px-6">
        <section className="flex flex-col items-center pt-16 pb-20 text-center sm:pt-24">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-indigo-500/30
                           bg-indigo-500/10 px-3.5 py-1.5 text-xs font-medium text-indigo-300">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
            Glass-box agent gateway
          </span>

          <h1 className="max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-6xl">
            <span className="bg-gradient-to-br from-white via-indigo-100 to-violet-300 bg-clip-text text-transparent">
              Prove what your AI
            </span>
            <br />
            <span className="bg-gradient-to-br from-indigo-300 via-violet-400 to-blue-400 bg-clip-text text-transparent">
              actually did.
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-gray-400 sm:text-lg">
            Every thought, tool call, and decision — signed, timestamped, and yours to
            verify. attest-ai wraps any LLM in a cryptographically signed, tamper-evident
            trace anyone can check independently.
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href="/login"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r
                         from-indigo-500 to-violet-600 px-6 py-3 text-sm font-semibold text-white
                         shadow-lg shadow-indigo-900/40 transition-all hover:from-indigo-400 hover:to-violet-500"
            >
              Get started
              <svg
                className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
            <a
              href="/docs"
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5
                         px-6 py-3 text-sm font-semibold text-gray-200 backdrop-blur transition-colors
                         hover:bg-white/10"
            >
              Read the docs
            </a>
          </div>

          <p className="mt-5 font-mono text-xs text-gray-600">
            OpenAI-compatible · Ed25519 signed · self-hostable
          </p>
        </section>

        {/* Features */}
        <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-gray-800 bg-gray-900/60 p-5 backdrop-blur
                         transition-colors hover:border-indigo-500/40"
            >
              <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg
                               bg-gradient-to-br from-indigo-500/20 to-violet-600/20 text-indigo-300
                               ring-1 ring-inset ring-indigo-500/20">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={f.icon} />
                </svg>
              </span>
              <h3 className="text-sm font-semibold text-gray-100">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-gray-500">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-gray-900">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-6
                        sm:flex-row">
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br
                             from-indigo-500 to-violet-600 text-[10px] font-bold text-white">
              A
            </span>
            attest-ai
          </div>
          <div className="flex items-center gap-5 text-xs text-gray-600">
            <a href="/docs" className="transition-colors hover:text-gray-300">Docs</a>
            <a href="/login" className="transition-colors hover:text-gray-300">Log in</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
