'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, CheckCircle2, UsersRound } from 'lucide-react'
import type { PackageCheckout } from '@/lib/checkout/options'
import type { PackagePrefill } from '@/lib/checkout/prefill'
import { formatCalendarDate, DATE_LONG } from '@/lib/time'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

type Slot = 'hotelMakkah' | 'hotelMadinah' | 'transport' | 'visa' | 'catering'
const SLOTS: readonly Slot[] = ['hotelMakkah', 'hotelMadinah', 'transport', 'visa', 'catering']
const SLOT_KEY = { hotelMakkah: 'hotelMakkahScheduleId', hotelMadinah: 'hotelMadinahScheduleId', transport: 'transportPricingId', visa: 'visaProductId', catering: 'cateringOptionId' } as const

// Paket Umroh: KEBERANGKATAN dari daftar admin (K1 — bukan tanggal bebas; yang penuh tampil mati), jumlah jamaah, dan pilihan HANYA untuk komponen yang paketnya
// memberi pilihan (`user_choice`). Komponen pilihan boleh dikosongkan kecuali tiket pesawat, yang membatasi keberangkatan ke periode tiketnya.
export function PackageFields({ product, today, maxPeople, onChange, initial = {} }: { product: PackageCheckout; today: string; maxPeople: number; onChange: FieldsChange; initial?: PackagePrefill }) {
  const t = useTranslations('checkout')
  const locale = useLocale()
  const day = (d: string, long = false) => formatCalendarDate(d, long ? DATE_LONG : undefined, locale)
  // Isian awal (halaman detail paket): hanya petunjuk — keberangkatan yang tak ada di daftar diabaikan, jumlah dibatasi.
  const [departureId, setDepartureId] = useState(initial.departure ?? '')
  const [people, setPeople] = useState(Math.min(maxPeople, Math.max(1, initial.pax ?? 1)))
  const [flightId, setFlightId] = useState(product.choices.flight.length === 1 ? product.choices.flight[0]!.id : '')
  const [picked, setPicked] = useState<Record<Slot, string>>({ hotelMakkah: '', hotelMadinah: '', transport: '', visa: '', catering: '' })

  const period = useMemo(() => {
    if (product.includedFlight) return product.includedFlight
    const f = product.choices.flight.find(o => o.id === flightId)
    return f ? { from: f.from, to: f.to } : null
  }, [product, flightId])
  const needsFlight = product.choices.flight.length > 0
  // Keberangkatan di luar periode tiket ditolak mesin (lib/booking/packageItem.ts) — jadi tidak ditawarkan.
  const departures = useMemo(() => product.departures.filter(d => d.departureDate >= today && (!period || (d.departureDate >= period.from && d.departureDate <= period.to))), [product, period, today])
  const picked1 = departures.find(d => d.id === departureId)

  useEffect(() => {
    if (product.blocked) { onChange(null, t(`blocked.${product.blocked}`)); return }
    if (needsFlight && !flightId) { onChange(null, t('package.missing.pickFlight')); return }
    if (!picked1) { onChange(null, t('package.missing.pickDeparture')); return }
    const choices: Record<string, string> = {}
    for (const s of Object.keys(SLOT_KEY) as Slot[]) if (picked[s]) choices[SLOT_KEY[s]] = picked[s]
    if (flightId && needsFlight) choices.flightScheduleId = flightId
    onChange({ kind: 'package', packageId: product.id, departureId: picked1.id, numPeople: people, choices }, null)
  }, [product, picked1, people, flightId, picked, needsFlight, onChange, t])

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
            <ChoiceSelect ariaLabel={t('package.flight')} value={flightId} onChange={v => { setFlightId(v); setDepartureId('') }} placeholder={t('package.pickFlight')}
              options={product.choices.flight.map(o => ({ id: o.id, label: `${o.label} · ${day(o.from)} – ${day(o.to)}`, hint: priceHint(o.hint, t('common.perPersonShort')) }))} />
          </div>
        )}
        <fieldset className="space-y-1.5" disabled={needsFlight && !flightId}>
          <legend className="checkout-label">
            {t('package.departure')}
            {product.durationDays ? <span className="font-normal text-muted-foreground"> · {t('package.duration', { days: product.durationDays })}</span> : null}
          </legend>
          {needsFlight && !flightId ? <p className="text-sm text-muted-foreground">{t('package.pickFlight')}</p> : (
            <div className="grid gap-2 sm:grid-cols-2">
              {departures.map(d => {
                const full = d.seatsLeft < 1
                const on = d.id === departureId
                return (
                  <button key={d.id} type="button" disabled={full} aria-pressed={on} onClick={() => setDepartureId(d.id)}
                    className={`rounded-xl border px-3 py-2.5 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'border-brand bg-brand-light' : 'border-border hover:border-brand'}`}>
                    <span className="block font-semibold text-brand-dark">{t('package.departureOption', { from: day(d.departureDate), to: day(d.returnDate) })}</span>
                    <span className="block text-xs text-muted-foreground">{full ? t('package.soldOut') : t('package.seatsLeft', { seats: d.seatsLeft })}</span>
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
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
