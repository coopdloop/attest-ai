'use client'

/**
 * Self-contained SVG/flow diagrams for the docs page. No external deps —
 * everything is hand-drawn with divs + SVG so it renders identically anywhere.
 */

// ── The core problem: black box vs glass box ──────────────────────────────────

export function BlackBoxVsGlassBox() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Black box */}
      <div className="rounded-xl border border-red-900/40 bg-red-950/10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-5 h-5 rounded bg-gray-700 inline-block" aria-hidden />
          <h4 className="text-sm font-semibold text-red-300">Black box (today)</h4>
        </div>
        <div className="space-y-2 text-xs text-gray-400">
          <FlowBox tone="neutral">You ask the AI something</FlowBox>
          <Arrow />
          <FlowBox tone="danger">??? — hidden reasoning, hidden tool calls</FlowBox>
          <Arrow />
          <FlowBox tone="neutral">You get an answer</FlowBox>
        </div>
        <p className="mt-3 text-xs text-red-300/70">
          You can&apos;t prove <em>what</em> the model did, <em>which</em> model ran,
          or whether the logs were edited afterward.
        </p>
      </div>

      {/* Glass box */}
      <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/10 p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-5 h-5 rounded border-2 border-emerald-400/70 inline-block" aria-hidden />
          <h4 className="text-sm font-semibold text-emerald-300">Glass box (attest-ai)</h4>
        </div>
        <div className="space-y-2 text-xs text-gray-400">
          <FlowBox tone="neutral">You ask the AI something</FlowBox>
          <Arrow />
          <FlowBox tone="success">Every step recorded + hash-chained</FlowBox>
          <Arrow />
          <FlowBox tone="success">Answer + a signed receipt anyone can verify</FlowBox>
        </div>
        <p className="mt-3 text-xs text-emerald-300/70">
          The full sequence is captured, tamper-evident, and cryptographically
          signed — independently checkable, even offline.
        </p>
      </div>
    </div>
  )
}

// ── Hash chain visual ─────────────────────────────────────────────────────────

export function HashChainDiagram() {
  const blocks = [
    { seq: 0, type: 'reasoning', label: 'Reasoning step' },
    { seq: 1, type: 'tool_call', label: 'Tool call: port_scan' },
    { seq: 2, type: 'tool_resp', label: 'Tool response' },
    { seq: 3, type: 'completion', label: 'Final answer' },
  ]
  const colors: Record<string, string> = {
    reasoning: 'border-blue-500/50 bg-blue-500/10',
    tool_call: 'border-yellow-500/50 bg-yellow-500/10',
    tool_resp: 'border-green-500/50 bg-green-500/10',
    completion: 'border-emerald-500/50 bg-emerald-500/10',
  }
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex items-stretch gap-0 min-w-max">
        <div className="flex flex-col items-center justify-center px-3">
          <div className="w-14 h-14 rounded-full border-2 border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500 text-center leading-tight">
            genesis 000…
          </div>
        </div>
        {blocks.map((b, i) => (
          <div key={b.seq} className="flex items-center">
            <ChainLink />
            <div className={`w-40 rounded-lg border ${colors[b.type]} p-3`}>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">seq {b.seq}</div>
              <div className="text-xs text-gray-200 font-medium mt-0.5">{b.label}</div>
              <div className="mt-2 space-y-1 font-mono text-[9px] text-gray-500">
                <div>payload_hash: {hex(b.seq, 'p')}</div>
                <div className="text-gray-400">chain_hash: {hex(b.seq, 'c')}</div>
                {i > 0 && <div>prev: {hex(b.seq - 1, 'c')}</div>}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Each block&apos;s <span className="font-mono text-gray-400">chain_hash = SHA-256(prev_hash + payload_hash)</span>.
        Change any earlier block and every hash after it breaks — that&apos;s what makes it <em>tamper-evident</em>.
      </p>
    </div>
  )
}

function hex(seed: number, kind: string) {
  // Deterministic fake hash for illustration only.
  const base = (seed * 2654435761 + kind.charCodeAt(0) * 40503) >>> 0
  return base.toString(16).padStart(8, '0').slice(0, 8) + '…'
}

function ChainLink() {
  return (
    <div className="flex items-center px-1 text-gray-600" aria-hidden>
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    </div>
  )
}

// ── Architecture / request flow ───────────────────────────────────────────────

export function RequestFlowDiagram() {
  const steps = [
    { n: 1, actor: 'You / any OpenAI client', desc: 'Send a chat request with an atai_ API key', color: 'bg-blue-600' },
    { n: 2, actor: 'API Gateway', desc: 'Checks your key, rate-limits, forwards the request', color: 'bg-indigo-600' },
    { n: 3, actor: 'Orchestrator', desc: 'Runs the model + tools in a reason→act loop', color: 'bg-purple-600' },
    { n: 4, actor: 'Attestation Service', desc: 'Records each step into a hash chain', color: 'bg-fuchsia-600' },
    { n: 5, actor: 'Signing Service', desc: 'Signs the final chain root with an Ed25519 key', color: 'bg-emerald-600' },
    { n: 6, actor: 'You', desc: 'Get the answer + a signed, verifiable receipt', color: 'bg-blue-600' },
  ]
  return (
    <div className="space-y-2">
      {steps.map((s, i) => (
        <div key={s.n}>
          <div className="flex items-start gap-3">
            <div className={`shrink-0 w-7 h-7 rounded-full ${s.color} text-white text-xs font-bold flex items-center justify-center`}>
              {s.n}
            </div>
            <div className="flex-1 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2">
              <div className="text-xs font-semibold text-gray-200">{s.actor}</div>
              <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
            </div>
          </div>
          {i < steps.length - 1 && (
            <div className="ml-3.5 h-3 w-px bg-gray-700" aria-hidden />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Verification flow ─────────────────────────────────────────────────────────

export function VerificationDiagram() {
  return (
    <div className="grid md:grid-cols-3 gap-3">
      <VerifyCard
        n={1}
        title="Recompute the chain"
        body="Walk every event and recompute SHA-256(prev + payload). If any recomputed hash doesn't match, the trace was tampered with."
        tone="blue"
      />
      <VerifyCard
        n={2}
        title="Check the signature"
        body="Take the chain's root hash and verify the Ed25519 signature against the organization's public key."
        tone="purple"
      />
      <VerifyCard
        n={3}
        title="Trust the result"
        body="If both pass, you have cryptographic proof of exactly what the AI did — no need to trust the server that stored it."
        tone="emerald"
      />
    </div>
  )
}

function VerifyCard({ n, title, body, tone }: {
  n: number; title: string; body: string; tone: 'blue' | 'purple' | 'emerald'
}) {
  const toneMap = {
    blue: { border: 'border-blue-900/40 bg-blue-950/10', badge: 'bg-blue-600' },
    purple: { border: 'border-purple-900/40 bg-purple-950/10', badge: 'bg-purple-600' },
    emerald: { border: 'border-emerald-900/40 bg-emerald-950/10', badge: 'bg-emerald-600' },
  }
  return (
    <div className={`rounded-xl border ${toneMap[tone].border} p-4`}>
      <div className={`w-7 h-7 rounded-full ${toneMap[tone].badge} text-white text-xs font-bold flex items-center justify-center mb-2`}>
        {n}
      </div>
      <h4 className="text-xs font-semibold text-gray-200 mb-1">{title}</h4>
      <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function FlowBox({ children, tone }: { children: React.ReactNode; tone: 'neutral' | 'danger' | 'success' }) {
  const toneMap = {
    neutral: 'border-gray-700 bg-gray-800/50 text-gray-300',
    danger: 'border-red-800/50 bg-red-950/20 text-red-300',
    success: 'border-emerald-800/50 bg-emerald-950/20 text-emerald-300',
  }
  return (
    <div className={`rounded-lg border px-3 py-2 text-center ${toneMap[tone]}`}>
      {children}
    </div>
  )
}

function Arrow() {
  return (
    <div className="flex justify-center text-gray-600" aria-hidden>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
      </svg>
    </div>
  )
}
