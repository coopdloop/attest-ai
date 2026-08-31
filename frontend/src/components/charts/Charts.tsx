'use client'

// Dependency-free SVG charts. Dark-theme tuned for the attest-ai dashboards.

export function AreaChart({
  data, height = 180, color = '#3b82f6', fill = 'rgba(59,130,246,0.15)', valueKey, format,
}: {
  data: Array<Record<string, number | string>>
  height?: number
  color?: string
  fill?: string
  valueKey: string
  format?: (v: number) => string
}) {
  const W = 640
  const H = height
  const pad = { top: 12, right: 12, bottom: 20, left: 44 }
  const vals = data.map(d => Number(d[valueKey]) || 0)
  const max = Math.max(1, ...vals)
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom
  const n = data.length

  if (n === 0) return <Empty height={height} />

  const x = (i: number) => pad.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw)
  const y = (v: number) => pad.top + ih - (v / max) * ih

  const line = vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
  const area = `${line} L ${x(n - 1)} ${pad.top + ih} L ${x(0)} ${pad.top + ih} Z`
  const fmt = format ?? ((v: number) => String(Math.round(v)))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {[0, 0.5, 1].map(t => (
        <g key={t}>
          <line x1={pad.left} x2={W - pad.right} y1={pad.top + ih * t} y2={pad.top + ih * t}
                stroke="#1f2937" strokeWidth={1} />
          <text x={pad.left - 6} y={pad.top + ih * t + 3} textAnchor="end"
                className="fill-gray-600" fontSize={9}>{fmt(max * (1 - t))}</text>
        </g>
      ))}
      <path d={area} fill={fill} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      {vals.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={color} />
      ))}
    </svg>
  )
}

export function BarChart({
  data, height = 180, color = '#8b5cf6', valueKey, labelKey, format,
}: {
  data: Array<Record<string, number | string>>
  height?: number
  color?: string
  valueKey: string
  labelKey: string
  format?: (v: number) => string
}) {
  const W = 640
  const H = height
  const pad = { top: 12, right: 12, bottom: 24, left: 44 }
  const vals = data.map(d => Number(d[valueKey]) || 0)
  const max = Math.max(1, ...vals)
  const iw = W - pad.left - pad.right
  const ih = H - pad.top - pad.bottom
  const n = data.length
  if (n === 0) return <Empty height={height} />

  const bw = (iw / n) * 0.62
  const gap = (iw / n) * 0.38
  const fmt = format ?? ((v: number) => String(Math.round(v)))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {[0, 0.5, 1].map(t => (
        <line key={t} x1={pad.left} x2={W - pad.right} y1={pad.top + ih * t} y2={pad.top + ih * t}
              stroke="#1f2937" strokeWidth={1} />
      ))}
      {vals.map((v, i) => {
        const h = (v / max) * ih
        const x = pad.left + i * (bw + gap) + gap / 2
        const yv = pad.top + ih - h
        return (
          <g key={i}>
            <rect x={x} y={yv} width={bw} height={h} rx={2} fill={color} opacity={0.85}>
              <title>{fmt(v)}</title>
            </rect>
            {n <= 14 && (
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="fill-gray-600" fontSize={8}>
                {String(data[i][labelKey]).slice(5)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function Donut({
  data, size = 180,
}: {
  data: Array<{ label: string; value: number; color: string }>
  size?: number
}) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const r = size / 2
  const stroke = 26
  const rad = r - stroke / 2
  const circ = 2 * Math.PI * rad
  let offset = 0
  if (total === 0) return <Empty height={size} />

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }}>
      <g transform={`rotate(-90 ${r} ${r})`}>
        {data.map((d, i) => {
          const frac = d.value / total
          const dash = frac * circ
          const seg = (
            <circle key={i} cx={r} cy={r} r={rad} fill="none" stroke={d.color}
                    strokeWidth={stroke} strokeDasharray={`${dash} ${circ - dash}`}
                    strokeDashoffset={-offset}>
              <title>{`${d.label}: ${((frac) * 100).toFixed(1)}%`}</title>
            </circle>
          )
          offset += dash
          return seg
        })}
      </g>
      <text x={r} y={r - 4} textAnchor="middle" className="fill-gray-200" fontSize={22} fontWeight={700}>
        {total.toLocaleString()}
      </text>
      <text x={r} y={r + 14} textAnchor="middle" className="fill-gray-500" fontSize={10}>requests</text>
    </svg>
  )
}

export function Gauge({ pct, size = 200, label }: { pct: number; size?: number; label?: string }) {
  const r = size / 2
  const stroke = 16
  const rad = r - stroke
  const circ = Math.PI * rad // half circle
  const clamped = Math.max(0, Math.min(100, pct))
  const dash = (clamped / 100) * circ
  const color = clamped >= 99.9 ? '#10b981' : clamped >= 80 ? '#f59e0b' : '#ef4444'

  return (
    <svg viewBox={`0 0 ${size} ${size / 1.7}`} style={{ width: size }}>
      <g transform={`translate(0 ${r})`}>
        <path d={arcPath(r, r, rad, 180, 360)} fill="none" stroke="#1f2937" strokeWidth={stroke} strokeLinecap="round" />
        <path d={arcPath(r, r, rad, 180, 180 + (clamped / 100) * 180)} fill="none"
              stroke={color} strokeWidth={stroke} strokeLinecap="round"
              style={{ transition: 'all 0.8s ease' }} />
        <text x={r} y={-8} textAnchor="middle" fill={color} fontSize={30} fontWeight={800}>
          {clamped.toFixed(clamped >= 99.95 || clamped === 0 ? 0 : 1)}%
        </text>
        {label && <text x={r} y={12} textAnchor="middle" className="fill-gray-500" fontSize={11}>{label}</text>}
      </g>
      <circle r={dash} opacity={0} />
    </svg>
  )
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p0 = polar(cx, cy, r, a0)
  const p1 = polar(cx, cy, r, a1)
  const large = a1 - a0 <= 180 ? 0 : 1
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`
}
function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function Empty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center text-xs text-gray-600" style={{ height }}>
      No data in this window yet
    </div>
  )
}

export const PALETTE = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
]
