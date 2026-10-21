import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone = 'ok' | 'warning' | 'danger' | 'neutral' | 'accent'

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: 'bg-admin-ok/12 text-admin-ok',
  warning: 'bg-admin-warning/14 text-admin-warning',
  danger: 'bg-admin-danger/12 text-admin-danger',
  neutral: 'bg-admin-spot text-admin-muted',
  accent: 'bg-admin-accent/12 text-admin-accent-strong',
}

/** `tone` = status SEMANTIK; petakan dari status data di satu tempat, bukan per halaman. */
export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em]',
        TONE_CLASS[tone],
        className,
      )}
      {...rest}
    />
  )
}
