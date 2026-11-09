'use client'

import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, UsersRound } from 'lucide-react'
import type { PackageCheckout } from '@/lib/checkout/options'
import { formatCalendarDate, DATE_LONG } from '@/lib/time'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

type Slot = 'hotelMakkah' | 'hotelMadinah' | 'transport' | 'visa' | 'catering'
const SLOT_LABEL: Record<Slot, string> = { hotelMakkah: 'Hotel Makkah', hotelMadinah: 'Hotel Madinah', transport: 'Kendaraan', visa: 'Visa', catering: 'Katering' }
const SLOT_KEY = { hotelMakkah: 'hotelMakkahScheduleId', hotelMadinah: 'hotelMadinahScheduleId', transport: 'transportPricingId', visa: 'visaProductId', catering: 'cateringOptionId' } as const

// Paket Umroh: tanggal berangkat (dalam periode tiket), jumlah jamaah, dan pilihan HANYA untuk komponen yang paketnya memberi pilihan (`user_choice`).
// Komponen pilihan boleh dikosongkan (tidak dibeli) kecuali tiket pesawat, yang menentukan tanggal berangkat.
export function PackageFields({ product, today, maxPeople, onChange }: { product: PackageCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const [date, setDate] = useState('')
  const [people, setPeople] = useState(1)
  const [flightId, setFlightId] = useState(product.choices.flight.length === 1 ? product.choices.flight[0]!.id : '')
  const [picked, setPicked] = useState<Record<Slot, string>>({ hotelMakkah: '', hotelMadinah: '', transport: '', visa: '', catering: '' })

  const period = useMemo(() => {
    if (product.includedFlight) return product.includedFlight
    const f = product.choices.flight.find(o => o.id === flightId)
    return f ? { from: f.from, to: f.to, label: f.label } : null
  }, [product, flightId])
  const needsFlight = product.choices.flight.length > 0
  const min = period?.from ?? today
  const max = period?.to

  useEffect(() => {
    if (product.blocked) { onChange(null, product.blocked); return }
    if (needsFlight && !flightId) { onChange(null, 'Pilih jadwal tiket pesawat'); return }
    if (!date) { onChange(null, 'Pilih tanggal berangkat'); return }
    if (date < min || (max && date > max)) { onChange(null, 'Tanggal berangkat di luar periode yang tersedia'); return }
    const choices: Record<string, string> = {}
    for (const s of Object.keys(SLOT_KEY) as Slot[]) if (picked[s]) choices[SLOT_KEY[s]] = picked[s]
    if (flightId && needsFlight) choices.flightScheduleId = flightId
    onChange({ kind: 'package', packageId: product.id, departureDate: date, numPeople: people, choices }, null)
  }, [product, date, people, flightId, picked, needsFlight, min, max, onChange])

  const slots = (Object.keys(SLOT_LABEL) as Slot[]).filter(s => product.choices[s].length > 0)

  return (
    <div className="space-y-5">
      {product.included.length > 0 && (
        <div className="checkout-panel">
          <h2 className="text-base font-bold text-brand-dark">Sudah termasuk</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {product.included.map(x => <li key={x} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {x}</li>)}
          </ul>
        </div>
      )}

      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Jadwal & jumlah jamaah</h2>
        {needsFlight && (
          <div className="space-y-1.5">
            <label className="checkout-label">Tiket pesawat</label>
            <ChoiceSelect ariaLabel="Tiket pesawat" value={flightId} onChange={v => { setFlightId(v); setDate('') }} placeholder="Pilih jadwal tiket"
              options={product.choices.flight.map(o => ({ id: o.id, label: `${o.label} · ${formatCalendarDate(o.from)} – ${formatCalendarDate(o.to)}`, hint: priceHint(o.hint, '/org') }))} />
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="departure" className="checkout-label">Tanggal berangkat</label>
            <input id="departure" type="date" className="checkout-input" value={date} min={min} max={max} disabled={needsFlight && !flightId} onChange={e => setDate(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {period ? `Tersedia ${formatCalendarDate(period.from, DATE_LONG)} – ${formatCalendarDate(period.to, DATE_LONG)}` : 'Pilih tanggal mulai hari ini'}
              {product.nights > 0 ? ` · ${product.nights} malam` : ''}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah jamaah</label>
            <PeopleStepper id="people" value={people} onChange={setPeople} max={maxPeople} />
          </div>
        </div>
      </div>

      {slots.length > 0 && (
        <div className="checkout-panel">
          <div>
            <h2 className="text-base font-bold text-brand-dark">Pilihan paket</h2>
            <p className="text-sm text-muted-foreground">Pilih sesuai kebutuhan; kosongkan bila tidak perlu. Harga di samping adalah perkiraan per orang (kendaraan: per unit).</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {slots.map(s => (
              <div key={s} className="space-y-1.5">
                <label className="checkout-label">{SLOT_LABEL[s]} <span className="font-normal text-muted-foreground">(opsional)</span></label>
                <ChoiceSelect ariaLabel={SLOT_LABEL[s]} value={picked[s]} onChange={v => setPicked(p => ({ ...p, [s]: v }))} placeholder={`Tanpa ${SLOT_LABEL[s].toLowerCase()}`}
                  options={product.choices[s].map(o => ({ id: o.id, label: o.label, hint: priceHint(o.hint) }))} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
