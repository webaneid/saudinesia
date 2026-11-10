'use client'

import { useEffect, useState } from 'react'
import { Plane, PlaneLanding, UsersRound } from 'lucide-react'
import type { FlightCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate, isCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'

const later = (a: string, b: string) => (a > b ? a : b)
const period = (from: string, to: string) => `${formatCalendarDate(from, DATE_LONG)} – ${formatCalendarDate(to, DATE_LONG)}`

// Tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.6, K11b-1 = b): tanggal terbang di dalam periode jadwal (≥ hari ini) + jumlah penumpang;
// tiket PULANG opsional = jadwal rute kebalikan (dua item tiket dalam satu booking). Periode & kursi diperiksa ulang mesin (422/409).
export function FlightFields({ product, today, maxPeople, onChange }: { product: FlightCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const s = product.schedule
  const [rawDate, setDate] = useState('')
  const [returnId, setReturnId] = useState('')
  const [rawReturn, setReturnDate] = useState('')
  const [people, setPeople] = useState(1)

  const date = isCalendarDate(rawDate) ? rawDate : ''
  const ret = product.returns.find(r => r.id === returnId) ?? null
  const returnDate = isCalendarDate(rawReturn) ? rawReturn : ''
  const minDate = later(today, s.from)
  const returnMin = ret ? later(later(date || minDate, today), ret.from) : today
  const cap = Math.max(0, Math.min(maxPeople, s.seatsLeft, ret ? ret.seatsLeft : Infinity))

  useEffect(() => {
    if (product.blocked) { onChange(null, product.blocked); return }
    if (!date) { onChange(null, 'Pilih tanggal terbang'); return }
    if (date < minDate || date > s.to) { onChange(null, `Tanggal terbang harus di periode ${period(minDate, s.to)}`); return }
    if (ret) {
      if (!returnDate) { onChange(null, 'Pilih tanggal pulang'); return }
      if (returnDate < returnMin || returnDate > ret.to) { onChange(null, `Tanggal pulang harus di periode ${period(returnMin, ret.to)}`); return }
    }
    if (cap < 1) { onChange(null, 'Kursi sudah habis'); return }
    onChange({
      kind: 'flight', flightScheduleId: s.id, departureDate: date, numPassengers: Math.min(people, cap),
      ...(ret && returnDate ? { returnScheduleId: ret.id, returnDate } : {}),
    }, null)
  }, [product, s, date, minDate, ret, returnDate, returnMin, cap, people, onChange])

  if (product.blocked) return <p className="checkout-panel text-sm text-destructive">{product.blocked}</p>

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><Plane className="h-4 w-4 text-brand" aria-hidden /> Berangkat · {s.label}</h2>
        <div className="space-y-1.5">
          <label htmlFor="depart" className="checkout-label">Tanggal terbang</label>
          <input id="depart" type="date" className="checkout-input" value={rawDate} min={minDate} max={s.to} onChange={e => setDate(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Periode jadwal {period(minDate, s.to)} · {formatRupiah(s.price)}/penumpang · sisa {s.seatsLeft} kursi</p>
      </div>

      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><PlaneLanding className="h-4 w-4 text-brand" aria-hidden /> Tiket pulang (opsional)</h2>
        {product.returns.length > 0 ? (
          <>
            <ChoiceSelect ariaLabel="Jadwal pulang" value={returnId} onChange={v => { setReturnId(v); setReturnDate('') }} placeholder="Tanpa tiket pulang"
              options={product.returns.map(r => ({ id: r.id, label: `${r.label} · ${period(r.from, r.to)}`, hint: `${formatRupiah(r.price)}/penumpang` }))} />
            {ret && (
              <div className="space-y-1.5">
                <label htmlFor="return" className="checkout-label">Tanggal pulang</label>
                <input id="return" type="date" className="checkout-input" value={rawReturn} min={returnMin} max={ret.to} onChange={e => setReturnDate(e.target.value)} />
                <p className="text-xs text-muted-foreground">{ret.airline ? `${ret.airline} · ` : ''}sisa {ret.seatsLeft} kursi</p>
              </div>
            )}
          </>
        ) : <p className="text-sm text-muted-foreground">Belum ada jadwal pulang untuk rute ini — pesan tiket pulang terpisah bila sudah tersedia.</p>}
      </div>

      <div className="checkout-panel">
        <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah penumpang</label>
        {cap > 0 ? <PeopleStepper id="people" value={Math.min(people, cap)} onChange={setPeople} max={cap} /> : <p className="text-sm text-destructive">Kursi sudah habis.</p>}
      </div>
    </div>
  )
}
