'use client'

import { useTranslations } from 'next-intl'
import { CalendarDays } from 'lucide-react'
import { isCalendarDate } from '@/lib/time'

type Props = { today: string; start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void; days: number; note?: string }

// Isian tanggal mulai–selesai layanan per hari (muthowif, katering). Nilai MENTAH dikembalikan ke pemanggil (lihat `serviceDays` di fields.ts);
// tanggal selesai terisi otomatis = tanggal mulai bila belum diisi atau jadi lebih awal.
export function ServiceDays({ today, start, end, onStart, onEnd, days, note }: Props) {
  const t = useTranslations('checkout.days')
  const validStart = isCalendarDate(start) ? start : ''
  return (
    <div className="checkout-panel">
      <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {t('title')}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="start" className="checkout-label">{t('start')}</label>
          <input id="start" type="date" className="checkout-input" value={start} min={today}
            onChange={e => { const v = e.target.value; onStart(v); if (isCalendarDate(v) && v >= today && (!isCalendarDate(end) || end < v)) onEnd(v) }} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="end" className="checkout-label">{t('end')}</label>
          <input id="end" type="date" className="checkout-input" value={end} min={validStart || today} disabled={!validStart}
            onChange={e => onEnd(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{days > 0 ? t('count', { days }) : t('hint')}{note ? ` ${note}` : ''}</p>
    </div>
  )
}
