import Link from 'next/link'
import { cn } from '@/lib/utils'

type FilterPillsProps = {
  options: { value: string; label: string }[]
  /** Nilai aktif; string kosong = "Semua". */
  current: string
  hrefFor: (value: string) => string
}

export function FilterPills({ options, current, hrefFor }: FilterPillsProps) {
  const all = [{ value: '', label: 'Semua' }, ...options]
  return (
    <div className="flex flex-wrap gap-2">
      {all.map(o => (
        <Link
          key={o.value || 'all'}
          href={hrefFor(o.value)}
          aria-current={current === o.value ? 'true' : undefined}
          className={cn(
            'rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors',
            current === o.value
              ? 'border-admin-accent bg-admin-accent text-white'
              : 'border-admin-line bg-white text-admin-muted hover:bg-admin-spot',
          )}
        >
          {o.label}
        </Link>
      ))}
    </div>
  )
}
