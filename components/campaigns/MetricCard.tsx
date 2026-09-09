import { MoreHorizontal, TrendingUp, ArrowRight } from 'lucide-react'

type SparklineProps = { data: number[]; color: string }

function Sparkline({ data, color }: SparklineProps) {
  const W = 96, H = 28, P = 2
  const max = Math.max(...data)
  const min = Math.min(...data)
  const pts: [number, number][] = data.map((v, i) => [
    P + (i * (W - P * 2)) / (data.length - 1),
    H - P - ((v - min) / Math.max(1, max - min)) * (H - P * 2),
  ])
  const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  // data is always non-empty (caller ensures 12-item trend array)
  const last = pts[pts.length - 1]!
  const first = pts[0]!
  const area = `${d} L${last[0]} ${H} L${first[0]} ${H} Z`
  const gradId = `sg${color.replace('#', '')}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-24 h-7 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.18} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={d} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  )
}

export type MetricTone = 'ink' | 'mint' | 'teal' | 'amber'

const TONE_CLASSES: Record<MetricTone, { wrap: string }> = {
  ink:   { wrap: 'bg-ink/5 text-ink' },
  mint:  { wrap: 'bg-mint-50 text-mint-700' },
  teal:  { wrap: 'bg-teal-50 text-teal-700' },
  amber: { wrap: 'bg-gold-50 text-gold-600' },
}

const SPARK_COLOR: Record<MetricTone, string> = {
  ink:   '#0F1B2D',
  mint:  '#3FA56A',
  teal:  '#11A892',
  amber: '#B07A1E',
}

export type MetricData = {
  icon: React.ElementType
  tone: MetricTone
  label: string
  value: string
  sub: string
  delta: string
  deltaTone: 'mint' | 'teal' | 'muted'
  trend: number[]
}

export function MetricCard({ m }: { m: MetricData }) {
  const { wrap } = TONE_CLASSES[m.tone]
  const sparkColor = SPARK_COLOR[m.tone]

  return (
    <div className="bg-white rounded-2xl border border-line/70 shadow-card p-5 flex flex-col gap-4 relative overflow-hidden">
      <div
        className="absolute -top-10 -right-10 h-32 w-32 rounded-full opacity-[0.05] pointer-events-none"
        style={{ background: sparkColor }}
      />
      <div className="flex items-start justify-between relative">
        <span className={`h-10 w-10 rounded-xl grid place-items-center shrink-0 ${wrap}`}>
          <m.icon className="h-[18px] w-[18px]" />
        </span>
        <button className="h-7 w-7 rounded-lg hover:bg-canvas grid place-items-center text-slate-500 transition-colors">
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative">
        <div className="text-[12.5px] text-slate-500 font-medium">{m.label}</div>
        <div className="mt-1 tabular-nums text-[28px] font-extrabold tracking-[-0.02em] text-ink leading-none">
          {m.value}
        </div>
        <div className="mt-1.5 text-[12px] text-slate-500 leading-snug">{m.sub}</div>
      </div>
      <div className="flex items-end justify-between relative">
        <div className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold rounded-full px-2 py-1 ${
          m.deltaTone === 'mint'
            ? 'bg-mint-50 text-mint-700'
            : m.deltaTone === 'teal'
            ? 'bg-teal-50 text-teal-700'
            : 'bg-canvas text-slate-500'
        }`}>
          {m.deltaTone === 'mint' && <TrendingUp className="h-3 w-3" />}
          {m.deltaTone === 'teal' && <ArrowRight className="h-3 w-3" />}
          {m.delta}
        </div>
        <Sparkline data={m.trend} color={sparkColor} />
      </div>
    </div>
  )
}
