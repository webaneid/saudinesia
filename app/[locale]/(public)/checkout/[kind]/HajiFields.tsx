'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, CheckCircle2, UsersRound } from 'lucide-react'
import type { HajiCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'

// Haji (keputusan H1 = b, §10.5): jumlah jamaah saja — jadwal milik produk. Tanpa visa umroh; syarat dokumen jamaah = milik produk Haji.
export function HajiFields({ product, maxPeople, onChange }: { product: HajiCheckout; maxPeople: number; onChange: FieldsChange }) {
  const t = useTranslations('checkout.haji')
  const locale = useLocale()
  const cap = Math.max(0, Math.min(maxPeople, product.seatsLeft))
  const [people, setPeople] = useState(1)

  useEffect(() => {
    if (product.price <= 0) { onChange(null, t('missing.unpriced')); return }
    if (cap < 1) { onChange(null, t('missing.soldOut')); return }
    onChange({ kind: 'haji', hajiProductId: product.id, numPeople: Math.min(people, cap) }, null)
  }, [product, people, cap, onChange, t])

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {t('schedule')}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-muted-foreground">{t('depart')}</dt><dd className="font-semibold">{product.departureDate ? formatCalendarDate(product.departureDate, DATE_LONG, locale) : t('season', { year: product.year })}</dd></div>
          {product.returnDate && <div><dt className="text-muted-foreground">{t('return')}</dt><dd className="font-semibold">{formatCalendarDate(product.returnDate, DATE_LONG, locale)}</dd></div>}
          {product.durationDays && <div><dt className="text-muted-foreground">{t('duration')}</dt><dd className="font-semibold">{t('durationDays', { days: product.durationDays })}</dd></div>}
        </dl>
        {product.includes.length > 0 && (
          <ul className="grid gap-2 border-t pt-4 sm:grid-cols-2">
            {product.includes.map(x => <li key={x} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {x}</li>)}
          </ul>
        )}
      </div>
      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('people')}</label>
        {cap > 0 ? <PeopleStepper id="people" value={Math.min(people, cap)} onChange={setPeople} max={cap} /> : <p className="text-sm text-destructive">{t('full')}</p>}
        {cap > 0 && product.seatsLeft < 10 && <p className="text-xs text-destructive">{t('seatsLeft', { count: product.seatsLeft })}</p>}
      </div>
    </div>
  )
}
