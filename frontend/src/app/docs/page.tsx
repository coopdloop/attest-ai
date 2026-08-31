'use client'

import { useState, useEffect, useRef } from 'react'
import {
  BlackBoxVsGlassBox,
  HashChainDiagram,
  RequestFlowDiagram,
  VerificationDiagram,
} from '@/components/docs/Diagrams'

const SECTIONS = [
  { id: 'what', label: 'What is attest-ai?' },
  { id: 'problem', label: 'The problem it solves' },
  { id: 'attestation', label: 'What is attestation?' },
  { id: 'analogy', label: 'A simple analogy' },
  { id: 'hashchain', label: 'The hash chain' },
  { id: 'signing', label: 'Signing the receipt' },
  { id: 'flow', label: 'How a request flows' },
  { id: 'verify', label: 'How verification works' },
  { id: 'trace', label: 'What is in a trace' },
  { id: 'glossary', label: 'Glossary' },
  { id: 'faq', label: 'FAQ' },
]

export default function DocsPage() {
  const [active, setActive] = useState('what')
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id)
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 }
    )
    SECTIONS.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observerRef.current?.observe(el)
    })
    return () => observerRef.current?.disconnect()
  }, [])

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-gray-100 flex">
      {/* TOC sidebar */}
      <aside className="w-64 shrink-0 border-r border-gray-800 overflow-y-auto hidden lg:block">
        <div className="px-5 py-5 border-b border-gray-800">
          <a href="/chat" className="flex items-center gap-2">
            <span className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-xs font-bold text-white">A</span>
            <span className="font-semibold text-sm">attest-ai docs</span>
          </a>
        </div>
        <nav className="p-3 space-y-0.5">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-2
                         ${active === s.id ? 'bg-gray-800 text-blue-300' : 'text-gray-500 hover:text-gray-200 hover:bg-gray-800/50'}`}
            >
              <span className="text-gray-700 font-mono w-4 shrink-0">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div className="p-4 mt-2 border-t border-gray-800">
          <a href="/chat" className="text-xs text-blue-400 hover:text-blue-300">← Back to app</a>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-12 space-y-16">
          {/* Hero */}
          <header className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-950/40 border border-blue-900/40 text-xs text-blue-300">
              Documentation
            </div>
            <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              Understanding attest-ai
            </h1>
            <p className="text-lg text-gray-400 leading-relaxed">
              A plain-English guide to what this app does, why it matters, and how
              &ldquo;attestation&rdquo; turns an AI&apos;s hidden reasoning into something
              you can <span className="text-gray-200">actually prove</span>.
            </p>
            <div className="flex flex-wrap gap-2 pt-2">
              {['No jargon', 'Beginner friendly', 'Diagrams included'].map(t => (
                <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-gray-900 border border-gray-800 text-gray-400">{t}</span>
              ))}
            </div>
          </header>

          {/* 1. What */}
          <Section id="what" title="What is attest-ai?" num={1}>
            <P>
              <B>attest-ai is a &ldquo;glass box&rdquo; in front of AI models.</B> When
              you (or an app) chat with an AI through it, it records{' '}
              <em>everything the AI did</em> — every reasoning step, every tool it
              called, the exact model used — and wraps that record in a{' '}
              <B>cryptographic signature</B>.
            </P>
            <P>
              The result is a <Term>receipt</Term> for each AI session. Anyone can
              later check that receipt and be mathematically certain the record
              wasn&apos;t altered — without having to trust the company that stored it.
            </P>
            <Callout tone="info" title="One sentence version">
              attest-ai makes &ldquo;what did the AI actually do?&rdquo; a question with a
              cryptographic answer, not just a log file someone could edit.
            </Callout>
          </Section>

          {/* 2. Problem */}
          <Section id="problem" title="The problem it solves" num={2}>
            <P>
              Today, when an AI agent does something — scans a network, reads a
              database, makes a decision — you usually just get the <em>final answer</em>.
              What happened in between is a black box. And even if the app shows you
              logs, those logs are just text: they can be edited, lost, or faked.
            </P>
            <P>For security, compliance, and legal teams, that&apos;s a serious gap:</P>
            <ul className="space-y-2 text-sm text-gray-400 list-none">
              <Bullet><B>Accountability:</B> If an AI agent did something harmful, can you prove exactly what it did?</Bullet>
              <Bullet><B>Compliance:</B> Auditors need evidence that can&apos;t be quietly changed after the fact.</Bullet>
              <Bullet><B>Trust:</B> How do you know the log wasn&apos;t edited before you saw it?</Bullet>
            </ul>
            <div className="pt-4">
              <BlackBoxVsGlassBox />
            </div>
          </Section>

          {/* 3. Attestation */}
          <Section id="attestation" title="What does 'attestation' actually mean?" num={3}>
            <P>
              <Term>Attestation</Term> is just a formal word for{' '}
              <B>&ldquo;a statement you can trust because it&apos;s cryptographically
              proven, not just claimed.&rdquo;</B>
            </P>
            <P>
              When a notary stamps a document, they&apos;re attesting: &ldquo;I witnessed
              this, and here&apos;s my seal to prove it.&rdquo; attest-ai does the digital
              version — it witnesses every step an AI takes and applies an
              unforgeable cryptographic seal.
            </P>
            <P>Attesting an AI chat means we can prove three things:</P>
            <div className="grid sm:grid-cols-3 gap-3 pt-2">
              <MiniCard title="Integrity" body="The record of what the AI did hasn't been changed since it happened." />
              <MiniCard title="Completeness" body="No steps were secretly removed — the chain would break if they were." />
              <MiniCard title="Authenticity" body="The receipt was really produced by this system, provable by its signature." />
            </div>
          </Section>

          {/* 4. Analogy */}
          <Section id="analogy" title="A simple analogy: the tamper-evident receipt" num={4}>
            <P>
              Imagine every action the AI takes is written on a page. attest-ai does
              two clever things with those pages:
            </P>
            <div className="space-y-3">
              <StepRow n={1} title="It chains the pages together">
                Each new page includes a <em>fingerprint</em> of the previous page.
                So page 3 &ldquo;knows&rdquo; what page 2 looked like. If someone edits
                page 2 later, page 3&apos;s fingerprint no longer matches — and the
                tampering is instantly obvious.
              </StepRow>
              <StepRow n={2} title="It seals the whole stack with a signature">
                Once the session ends, the entire stack gets a single wax seal (a
                digital signature). Only attest-ai&apos;s private key can make that
                seal, but <em>anyone</em> can check it with the matching public key.
              </StepRow>
            </div>
            <Callout tone="success" title="Why this is powerful">
              You don&apos;t have to trust the storage, the server, or even the company.
              The math itself proves whether the record is genuine and untouched.
            </Callout>
          </Section>

          {/* 5. Hash chain */}
          <Section id="hashchain" title="Under the hood: the hash chain" num={5}>
            <P>
              The &ldquo;fingerprint&rdquo; from the analogy is called a <Term>hash</Term> —
              a short string produced by running data through a one-way math function
              (SHA-256). Change even one character of the input and the hash changes
              completely.
            </P>
            <P>
              attest-ai links each event to the last one by hashing them together.
              This is the <Term>hash chain</Term>:
            </P>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
              <HashChainDiagram />
            </div>
            <CodeBlock>{`chain_hash = SHA-256( previous_chain_hash + this_payload_hash )`}</CodeBlock>
            <P>
              Because every link depends on the one before it, you can&apos;t change an
              early event without breaking every hash that follows. That&apos;s what
              &ldquo;tamper-evident&rdquo; means in practice.
            </P>
          </Section>

          {/* 6. Signing */}
          <Section id="signing" title="Sealing it: the digital signature" num={6}>
            <P>
              A hash chain proves the record is <em>internally consistent</em>, but on
              its own someone could rebuild the whole chain from scratch. The final
              step stops that: attest-ai takes the chain&apos;s last hash (the{' '}
              <Term>root hash</Term>) and signs it with a private{' '}
              <Term>Ed25519</Term> key that never leaves the signing service.
            </P>
            <div className="grid sm:grid-cols-2 gap-3">
              <MiniCard title="Private key (secret)" body="Held only by attest-ai's signing service. Used to create the signature. Never shared." />
              <MiniCard title="Public key (shareable)" body="Anyone can use it to verify a signature is genuine — but it can't be used to forge one." />
            </div>
            <Callout tone="info" title="Key idea">
              A signature made with the private key can be checked by anyone with the
              public key, but <B>only</B> the private key holder could have created it.
              That&apos;s what makes the receipt unforgeable.
            </Callout>
          </Section>

          {/* 7. Flow */}
          <Section id="flow" title="How a request flows through the system" num={7}>
            <P>
              attest-ai is built from several small services, each with one job. Here&apos;s
              what happens when you send a message:
            </P>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
              <RequestFlowDiagram />
            </div>
            <P className="text-gray-500 text-sm">
              The gateway handles auth and rate-limiting, the orchestrator runs the
              model-and-tools loop, the attestation service records each step, and the
              signing service seals the finished chain. You get the answer plus a
              signed receipt — all through a normal OpenAI-compatible API.
            </P>
          </Section>

          {/* 8. Verify */}
          <Section id="verify" title="How anyone can verify a receipt" num={8}>
            <P>
              Verification is the whole point. Given a trace and its bundle, checking
              it takes three steps — and none of them require trusting attest-ai:
            </P>
            <VerificationDiagram />
            <Callout tone="success" title="In this app">
              Open any session on the <A href="/traces">Traces</A> page. The timeline
              shows a live &ldquo;chain intact&rdquo; badge (step 1) and the bundle shows a
              &ldquo;signature valid&rdquo; badge (step 2). In chat, click{' '}
              <span className="text-emerald-400">view receipt</span> on any answer to
              see its signed bundle.
            </Callout>
          </Section>

          {/* 9. Trace */}
          <Section id="trace" title="What's actually inside a trace" num={9}>
            <P>A trace is the ordered list of events the AI produced. Common event types:</P>
            <div className="space-y-2">
              <EventType color="bg-blue-500" name="reasoning_step" desc="The model is thinking / planning its next move." />
              <EventType color="bg-yellow-500" name="tool_call" desc="The model invoked a tool (e.g. a port scan) with specific arguments." />
              <EventType color="bg-green-500" name="tool_response" desc="The result that tool returned." />
              <EventType color="bg-emerald-500" name="completion" desc="The final answer sent back to you." />
              <EventType color="bg-red-500" name="error" desc="Something went wrong during the run." />
            </div>
            <P className="text-gray-500 text-sm">
              Each event is hashed and linked into the chain the moment it happens, so
              the trace is built up live during the session and sealed at the end.
            </P>
          </Section>

          {/* 10. Glossary */}
          <Section id="glossary" title="Glossary" num={10}>
            <div className="space-y-3">
              <GlossaryItem term="Attestation" def="A cryptographically provable statement about what happened — not just a claim." />
              <GlossaryItem term="Hash (SHA-256)" def="A fixed-length fingerprint of some data. Any change to the data changes the hash completely." />
              <GlossaryItem term="Hash chain" def="A sequence of events where each one includes the hash of the previous one, making edits detectable." />
              <GlossaryItem term="Root hash" def="The final hash of the whole chain — a single fingerprint that represents the entire session." />
              <GlossaryItem term="Ed25519" def="A modern, fast digital-signature algorithm used to sign the root hash." />
              <GlossaryItem term="Signature" def="Proof, made with a private key, that a specific piece of data is authentic and unchanged." />
              <GlossaryItem term="Attestation bundle" def="The signed 'receipt' for a session: root hash, signature, key ID, and metadata." />
              <GlossaryItem term="Trace" def="The full, ordered record of events (reasoning, tool calls, responses) for one session." />
            </div>
          </Section>

          {/* 11. FAQ */}
          <Section id="faq" title="FAQ" num={11}>
            <FAQ q="Does this change the AI's answers?">
              No. attest-ai sits in front of the model and observes. It records and
              signs what happens; it doesn&apos;t alter the model&apos;s output.
            </FAQ>
            <FAQ q="Can attest-ai fake a receipt?">
              It could only sign records it actually produced. It can&apos;t retroactively
              change a sealed one without the tampering being detectable, and outside
              parties verify signatures with the public key — so a forged or edited
              trace fails verification.
            </FAQ>
            <FAQ q="Do I need special software to verify?">
              No. Verification uses standard SHA-256 and Ed25519 — available in every
              major programming language. You can even verify a bundle offline.
            </FAQ>
            <FAQ q="What if a session was created before signing was enabled?">
              Older sessions may have a trace but no signed bundle. The Traces page
              tells you when a bundle is missing and why.
            </FAQ>
            <FAQ q="Is this the same as blockchain?">
              It shares the &ldquo;hash-chained, tamper-evident&rdquo; idea, but there&apos;s no
              distributed ledger, tokens, or mining. It&apos;s a focused, private
              hash-chain-plus-signature system for AI sessions.
            </FAQ>
          </Section>

          <footer className="pt-8 border-t border-gray-800 text-xs text-gray-600">
            <p>
              Want to see it live? Head to the{' '}
              <A href="/chat">chat</A>, send a message, then click{' '}
              <span className="text-emerald-400">view receipt</span> or open the{' '}
              <A href="/traces">Traces</A> browser.
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}

// ── Presentational helpers ────────────────────────────────────────────────────

function Section({ id, title, num, children }: {
  id: string; title: string; num: number; children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-8 space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-gray-700">{String(num).padStart(2, '0')}</span>
        <div className="h-px flex-1 bg-gray-800" />
      </div>
      <h2 className="text-2xl font-semibold text-gray-100">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-[15px] text-gray-300 leading-relaxed ${className ?? ''}`}>{children}</p>
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-gray-100 font-semibold">{children}</strong>
}

function Term({ children }: { children: React.ReactNode }) {
  return <span className="text-blue-300 font-medium">{children}</span>
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className="text-blue-400 hover:text-blue-300 underline underline-offset-2">{children}</a>
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
      <span>{children}</span>
    </li>
  )
}

function Callout({ tone, title, children }: {
  tone: 'info' | 'success' | 'warn'; title: string; children: React.ReactNode
}) {
  const toneMap = {
    info: 'border-blue-900/50 bg-blue-950/20',
    success: 'border-emerald-900/50 bg-emerald-950/20',
    warn: 'border-yellow-900/50 bg-yellow-950/20',
  }
  const titleColor = {
    info: 'text-blue-300', success: 'text-emerald-300', warn: 'text-yellow-300',
  }
  return (
    <div className={`rounded-xl border ${toneMap[tone]} p-4`}>
      <div className={`text-xs font-semibold uppercase tracking-wide mb-1.5 ${titleColor[tone]}`}>{title}</div>
      <div className="text-sm text-gray-300 leading-relaxed">{children}</div>
    </div>
  )
}

function MiniCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3.5">
      <div className="text-sm font-semibold text-gray-200 mb-1">{title}</div>
      <div className="text-xs text-gray-500 leading-relaxed">{body}</div>
    </div>
  )
}

function StepRow({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-gray-800 bg-gray-900/40 p-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white text-sm font-bold flex items-center justify-center">
        {n}
      </div>
      <div>
        <div className="text-sm font-semibold text-gray-200 mb-1">{title}</div>
        <div className="text-sm text-gray-400 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="rounded-lg border border-gray-800 bg-gray-950 px-4 py-3 text-xs font-mono text-emerald-300 overflow-x-auto">
      {children}
    </pre>
  )
}

function EventType({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2.5">
      <span className={`w-2.5 h-2.5 rounded-full ${color} shrink-0`} />
      <code className="text-xs font-mono text-gray-200 w-32 shrink-0">{name}</code>
      <span className="text-xs text-gray-500">{desc}</span>
    </div>
  )
}

function GlossaryItem({ term, def }: { term: string; def: string }) {
  return (
    <div className="grid sm:grid-cols-[160px_1fr] gap-1 sm:gap-4 py-2 border-b border-gray-800/60">
      <dt className="text-sm font-semibold text-blue-300">{term}</dt>
      <dd className="text-sm text-gray-400 leading-relaxed">{def}</dd>
    </div>
  )
}

function FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-200 hover:bg-gray-800/40 transition-colors"
      >
        {q}
        <svg className={`w-4 h-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-4 pb-3.5 text-sm text-gray-400 leading-relaxed">{children}</div>}
    </div>
  )
}
