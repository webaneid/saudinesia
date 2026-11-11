'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { UsersRound } from 'lucide-react'
import type { CateringCheckout } from '@/lib/checkout/options'
import { formatRupiah } from '@/lib/utils'
import { CHECKOUT_MAX_DAYS } from '@/lib/validators/checkout'
import { PeopleStepper } from './PeopleStepper'
import { ServiceDays } from './ServiceDays'
import { serviceDays, type FieldsChange } from './fields'

const SEASONS = ['regular', 'ramadan', 'hajj'] as const

// Katering (docs/arsitektur-booking-engine-v2.md §10.6): tanggal + jumlah orang. Harga per orang per hari menurut MUSIM TANGGAL MULAI (dipilih mesin —
// angka yang mengikat ada di ringkasan pratinjau); musim yang belum berharga ditolak mesin (422), tak pernah gratis. Tanpa kuota.
export function CateringFields({ product, today, maxPeople, onChange }: { product: CateringCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const t = useTranslations('checkout')
  const [rawStart, setStart] = useState('')
  const [rawEnd, setEnd] = useState('')
  const [people, setPeople] = useState(1)
  const { start, end, days, missing } = serviceDays(rawStart, rawEnd, today, CHECKOUT_MAX_DAYS)
  const priced = SEASONS.filter(k => product.prices[k] > 0)

  useEffect(() => {
    if (priced.length === 0) { onChange(null, t('catering.missing.unpriced')); return }
    if (missing) { onChange(null, t(`days.${missing}`, { max: CHECKOUT_MAX_DAYS })); return }
    onChange({ kind: 'catering', cateringOptionId: product.id, startDate: start, endDate: end, numPeople: people }, null)
  }, [product, priced.length, start, end, missing, people, onChange, t])

  return (
    <div className="space-y-5">
      <ServiceDays today={today} start={rawStart} end={rawEnd} onStart={setStart} onEnd={setEnd} days={days} note={t('catering.seasonNote')} />
      {priced.length > 0 && (
        <div className="checkout-panel">
          <h2 className="text-base font-bold text-brand-dark">{t('catering.priceTitle')}</h2>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {priced.map(k => <div key={k}><dt className="text-muted-foreground">{t(`catering.season.${k}`)}</dt><dd className="font-semibold">{formatRupiah(product.prices[k])}</dd></div>)}
          </dl>
        </div>
      )}
      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('catering.people')}</label>
        <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
      </div>
    </div>
  )
}
