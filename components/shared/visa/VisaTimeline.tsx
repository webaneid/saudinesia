import { useTranslations } from 'next-intl'
import { CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react'
import type { VisaStatus } from '@prisma/client'
import { DATE_LONG, formatInstant } from '@/lib/time'
import { visaTimeline, type VisaEvent } from '@/lib/visa/timeline'

// Linimasa status visa satu jamaah (docs/arsitektur-visa.md §9) — SATU komponen untuk halaman jamaah dan admin (tanpa impor admin).
// Alasan penolakan (V2) ditampilkan selama status Ditolak; nama petugas hanya bila `actor` diisi (admin).

type Props = {
  status: VisaStatus
  events: ReadonlyArray<VisaEvent & { actor?: string | null }>
  rejectionReason?: string | null
  locale: string
}

export function VisaTimeline({ status, events, rejectionReason, locale }: Props) {
  const t = useTranslations('shared.visa')
  const steps = visaTimeline(status, events)
  const actorOf = (s: VisaStatus) => [...events].reverse().find(e => e.toStatus === s)?.actor
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {steps.map(s => {
          const Icon = s.state === 'done' ? CheckCircle2 : s.state === 'rejected' ? XCircle : s.state === 'current' ? CircleDot : Circle
          const tone = s.state === 'done' ? 'text-primary' : s.state === 'rejected' ? 'text-destructive' : s.state === 'current' ? 'text-amber-600' : 'text-muted-foreground/60'
          const actor = s.at ? actorOf(s.status) : undefined
          return (
            <li key={s.status} className="flex items-start gap-2 text-sm">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden />
              <div className="min-w-0">
                <p className={s.state === 'todo' ? 'text-muted-foreground' : 'font-medium text-foreground'}>
                  {t(`status.${s.status}`)}
                  {s.state === 'current' && <span className="ml-2 text-xs font-normal text-amber-700">{t('current')}</span>}
                </p>
                {s.at && <p className="text-xs text-muted-foreground">{formatInstant(s.at, DATE_LONG, undefined, locale)}{actor ? ` · ${actor}` : ''}</p>}
              </div>
            </li>
          )
        })}
      </ol>
      {status === 'rejected' && rejectionReason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{t('reasonTitle')}</p>
          <p className="whitespace-pre-line text-foreground">{rejectionReason}</p>
        </div>
      )}
    </div>
  )
}
