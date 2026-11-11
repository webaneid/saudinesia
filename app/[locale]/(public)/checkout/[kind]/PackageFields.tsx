'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, CheckCircle2, UsersRound } from 'lucide-react'
import type { PackageCheckout } from '@/lib/checkout/options'
import { formatCalendarDate, DATE_LONG } from '@/lib/time'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

type Slot = 'hotelMakkah' | 'hotelMadinah' | 'transport' | 'visa' | 'catering'
const SLOTS: readonly Slot[] = ['hotelMakkah', 'hotelMadinah', 'transport', 'visa', 'catering']
const SLOT_KEY = { hotelMakkah: 'hotelMakkahScheduleId', hotelMadinah: 'hotelMadinahScheduleId', transport: 'transportPricingId', visa: 'visaProductId', catering: 'cateringOptionId' } as const

// Paket Umroh: tanggal berangkat (dalam periode tiket), jumlah jamaah, dan pilihan HANYA untuk komponen yang paketnya memberi pilihan (`user_choice`).
// Komponen pilihan boleh dikosongkan (tidak dibeli) kecuali tiket pesawat, yang menentukan tanggal berangkat.
export function PackageFields({ product, today, maxPeople, onChange }: { product: PackageCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const t = useTranslations('checkout')
  const locale = useLocale()
  const day = (d: string, long = false) => formatCalendarDate(d, long ? DATE_LONG : undefined, locale)
  const [date, setDate] = useState('')
  const [people, setPeople] = useState(1)
  const [flightId, setFlightId] = useState(product.choices.flight.length === 1 ? product.choices.flight[0]!.id : '')
  const [picked, setPicked] = useState<Record<Slot, string>>({ hotelMakkah: '', hotelMadinah: '', transport: '', visa: '', catering: '' })

  const period = useMemo(() => {
    if (product.includedFlight) return product.includedFlight
    const f = product.choices.flight.find(o => o.id === flightId)
    return f ? { from: f.from, to: f.to } : null
  }, [product, flightId])
  const needsFlight = product.choices.flight.length > 0
  const min = period?.from ?? today
  const max = period?.to

  useEffect(() => {
    if (product.blocked) { onChange(null, t(`blocked.${product.blocked}`)); return }
    if (needsFlight && !flightId) { onChange(null, t('package.missing.pickFlight')); return }
    if (!date) { onChange(null, t('package.missing.pickDate')); return }
    if (date < min || (max && date > max)) { onChange(null, t('package.missing.outOfPeriod')); return }
    const choices: Record<string, string> = {}
    for (const s of Object.keys(SLOT_KEY) as Slot[]) if (picked[s]) choices[SLOT_KEY[s]] = picked[s]
    if (flightId && needsFlight) choices.flightScheduleId = flightId
    onChange({ kind: 'package', packageId: product.id, departureDate: date, numPeople: people, choices }, null)
  }, [product, date, people, flightId, picked, needsFlight, min, max, onChange, t])

  // Label opsi = data produk + jumlah malam/hari dalam bahasa halaman.
  const choiceLabel = (o: { label: string; nights?: number; days?: number }) =>
    o.nights !== undefined ? t('common.withNights', { label: o.label, nights: o.nights })
      : o.days !== undefined ? t('common.withDays', { label: o.label, days: o.days }) : o.label
  const slots = SLOTS.filter(s => product.choices[s].length > 0)

  return (
    <div className="space-y-5">
      {product.included.length > 0 && (
        <div className="checkout-panel">
          <h2 className="text-base font-bold text-brand-dark">{t('package.included')}</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {product.included.map(x => <li key={x.key} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {t(`package.includedItem.${x.key}`, { nights: x.nights ?? 0 })}</li>)}
          </ul>
        </div>
      )}

      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {t('package.schedule')}</h2>
        {needsFlight && (
          <div className="space-y-1.5">
            <label className="checkout-label">{t('package.flight')}</label>
            <ChoiceSelect ariaLabel={t('package.flight')} value={flightId} onChange={v => { setFlightId(v); setDate('') }} placeholder={t('package.pickFlight')}
              options={product.choices.flight.map(o => ({ id: o.id, label: `${o.label} · ${day(o.from)} – ${day(o.to)}`, hint: priceHint(o.hint, t('common.perPersonShort')) }))} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="departure" className="checkout-label">{t('package.departure')}</label>
            <input id="departure" type="date" className="checkout-input" value={date} min={min} max={max} disabled={needsFlight && !flightId} onChange={e => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {period ? t('package.available', { from: day(period.from, true), to: day(period.to, true) }) : t('package.fromToday')}
              {product.nights > 0 ? ` · ${t('common.nights', { nights: product.nights })}` : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('package.people')}</label>
            <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
          </div>
        </div>
      </div>

      {slots.length > 0 && (
        <div className="checkout-panel">
          <div>
            <h2 className="text-base font-bold text-brand-dark">{t('package.choices')}</h2>
            <p className="text-sm text-muted-foreground">{t('package.choicesHint')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map(s => (
              <div key={s} className="space-y-1.5">
                <label className="checkout-label">{t(`package.slot.${s}`)} <span className="font-normal text-muted-foreground">{t('common.optional')}</span></label>
                <ChoiceSelect ariaLabel={t(`package.slot.${s}`)} value={picked[s]} onChange={v => setPicked(p => ({ ...p, [s]: v }))} placeholder={t(`package.slotNone.${s}`)}
                  options={product.choices[s].map(o => ({ id: o.id, label: choiceLabel(o), hint: priceHint(o.hint) }))} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
