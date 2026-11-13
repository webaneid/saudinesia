'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Plane, PlaneLanding, UsersRound } from 'lucide-react'
import type { FlightCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate, isCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'
import type { FlightPrefill } from '@/lib/checkout/prefill'

const later = (a: string, b: string) => (a > b ? a : b)
const periodText = (from: string, to: string, locale: string) => `${formatCalendarDate(from, DATE_LONG, locale)} – ${formatCalendarDate(to, DATE_LONG, locale)}`

// Tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.6, K11b-1 = b): tanggal terbang di dalam periode jadwal (≥ hari ini) + jumlah penumpang;
// tiket PULANG opsional = jadwal rute kebalikan (dua item tiket dalam satu booking). Periode & kursi diperiksa ulang mesin (422/409).
export function FlightFields({ product, today, maxPeople, onChange, initial = {} }: { product: FlightCheckout; today: string; maxPeople: number; onChange: FieldsChange; initial?: FlightPrefill }) {
  const t = useTranslations('checkout')
  const locale = useLocale()
  const s = product.schedule
  // Isian awal dari kotak cari katalog (§9 H2): hanya petunjuk — periode/kursi tetap diperiksa di bawah dan oleh mesin pesan.
  const [rawDate, setDate] = useState<string>(initial.date ?? '')
  const [returnId, setReturnId] = useState(initial.ret && product.returns.some(r => r.id === initial.ret) ? initial.ret : '')
  const [rawReturn, setReturnDate] = useState<string>(initial.ret && initial.retDate ? initial.retDate : '')
  const [people, setPeople] = useState(initial.pax ?? 1)

  const date = isCalendarDate(rawDate) ? rawDate : ''
  const ret = product.returns.find(r => r.id === returnId) ?? null
  const returnDate = isCalendarDate(rawReturn) ? rawReturn : ''
  const minDate = later(today, s.from)
  const returnMin = ret ? later(later(date || minDate, today), ret.from) : today
  const cap = Math.max(0, Math.min(maxPeople, s.seatsLeft, ret ? ret.seatsLeft : Infinity))

  useEffect(() => {
    if (product.blocked) { onChange(null, t(`blocked.${product.blocked}`)); return }
    if (!date) { onChange(null, t('flight.missing.pickDate')); return }
    if (date < minDate || date > s.to) { onChange(null, t('flight.missing.outOfPeriod', { period: periodText(minDate, s.to, locale) })); return }
    if (ret) {
      if (!returnDate) { onChange(null, t('flight.missing.pickReturn')); return }
      if (returnDate < returnMin || returnDate > ret.to) { onChange(null, t('flight.missing.returnOutOfPeriod', { period: periodText(returnMin, ret.to, locale) })); return }
    }
    if (cap < 1) { onChange(null, t('flight.missing.soldOut')); return }
    onChange({
      kind: 'flight', flightScheduleId: s.id, departureDate: date, numPassengers: Math.min(people, cap),
      ...(ret && returnDate ? { returnScheduleId: ret.id, returnDate } : {}),
    }, null)
  }, [product, s, date, minDate, ret, returnDate, returnMin, cap, people, onChange, t, locale])

  if (product.blocked) return <p className="checkout-panel text-sm text-destructive">{t(`blocked.${product.blocked}`)}</p>

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><Plane className="h-4 w-4 text-brand" aria-hidden /> {t('flight.depart', { route: s.label })}</h2>
        <div className="space-y-1.5">
          <label htmlFor="depart" className="checkout-label">{t('flight.flyDate')}</label>
          <input id="depart" type="date" className="checkout-input" value={rawDate} min={minDate} max={s.to} onChange={e => setDate(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">{t('flight.periodInfo', { period: periodText(minDate, s.to, locale), price: formatRupiah(s.price), seats: s.seatsLeft })}</p>
      </div>

      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><PlaneLanding className="h-4 w-4 text-brand" aria-hidden /> {t('flight.returnTitle')}</h2>
        {product.returns.length > 0 ? (
          <>
            <ChoiceSelect ariaLabel={t('flight.returnSchedule')} value={returnId} onChange={v => { setReturnId(v); setReturnDate('') }} placeholder={t('flight.noReturn')}
              options={product.returns.map(r => ({ id: r.id, label: `${r.label} · ${periodText(r.from, r.to, locale)}`, hint: `${formatRupiah(r.price)}${t('common.perPassenger')}` }))} />
            {ret && (
              <div className="space-y-1.5">
                <label htmlFor="return" className="checkout-label">{t('flight.returnDate')}</label>
                <input id="return" type="date" className="checkout-input" value={rawReturn} min={returnMin} max={ret.to} onChange={e => setReturnDate(e.target.value)} />
                <p className="text-xs text-muted-foreground">{ret.airline ? `${ret.airline} · ` : ''}{t('common.seatsLeft', { count: ret.seatsLeft })}</p>
              </div>
            )}
          </>
        ) : <p className="text-sm text-muted-foreground">{t('flight.noReturns')}</p>}
      </div>

      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('flight.passengers')}</label>
        {cap > 0 ? <PeopleStepper id="people" value={Math.min(people, cap)} onChange={setPeople} max={cap} /> : <p className="text-sm text-destructive">{t('flight.soldOut')}</p>}
      </div>
    </div>
  )
}
