'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bus, CalendarDays, MapPin, UsersRound } from 'lucide-react'
import type { TransportCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'

// Transport: tanggal → kendaraan yang tersedia di tanggal itu (harga per kendaraan) → jumlah penumpang (dibatasi kapasitas & sisa kursi) + detail jemput/antar.
export function TransportFields({ product, maxPeople, onChange }: { product: TransportCheckout; maxPeople: number; onChange: FieldsChange }) {
  const dates = useMemo(() => [...new Set(product.slots.map(s => s.date))], [product])
  const [date, setDate] = useState(dates.length === 1 ? dates[0]! : '')
  const [quotaId, setQuotaId] = useState('')
  const [people, setPeople] = useState(1)
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')

  const slots = product.slots.filter(s => s.date === date)
  const slot = slots.find(s => s.quotaId === quotaId)
  const cap = slot ? Math.max(0, Math.min(maxPeople, slot.capacity, slot.seatsLeft)) : maxPeople

  useEffect(() => {
    if (product.slots.length === 0) { onChange(null, 'Belum ada jadwal kendaraan untuk rute ini'); return }
    if (!date) { onChange(null, 'Pilih tanggal perjalanan'); return }
    if (!slot) { onChange(null, 'Pilih kendaraan'); return }
    if (cap < 1) { onChange(null, 'Kendaraan ini sudah penuh di tanggal itu'); return }
    onChange({ kind: 'transport', transportQuotaId: slot.quotaId, numPassengers: Math.min(people, cap), ...(pickup.trim() ? { pickupDetail: pickup.trim() } : {}), ...(dropoff.trim() ? { dropoffDetail: dropoff.trim() } : {}) }, null)
  }, [product, date, slot, people, cap, pickup, dropoff, onChange])

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><MapPin className="h-4 w-4 text-brand" aria-hidden /> {product.origin} → {product.destination}</h2>
        <div className="space-y-1.5">
          <label className="checkout-label flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Tanggal perjalanan</label>
          {dates.length > 0
            ? <ChoiceSelect ariaLabel="Tanggal perjalanan" value={date} onChange={v => { setDate(v); setQuotaId('') }} placeholder="Pilih tanggal" clearable={false}
                options={dates.map(d => ({ id: d, label: formatCalendarDate(d, DATE_LONG) }))} />
            : <p className="text-sm text-muted-foreground">Belum ada jadwal — hubungi kami untuk tanggal lain.</p>}
        </div>
      </div>

      {date && (
        <div className="checkout-panel">
          <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><Bus className="h-4 w-4 text-brand" aria-hidden /> Pilih kendaraan</h2>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kendaraan">
            {slots.map(s => {
              const full = s.seatsLeft < 1
              const active = s.quotaId === quotaId
              return (
                <button key={s.quotaId} type="button" role="radio" aria-checked={active} disabled={full} onClick={() => setQuotaId(s.quotaId)}
                  className={`checkout-option disabled:opacity-50 ${active ? 'border-brand bg-brand-light' : ''}`}>
                  {s.cover
                    // eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private), sudah dikecilkan saat unggah
                    ? <img src={s.cover} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-lg object-cover" />
                    : <span className="grid h-14 w-20 shrink-0 place-items-center rounded-lg bg-brand-light"><Bus className="h-5 w-5 text-brand" aria-hidden /></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{s.vehicle}</span>
                    <span className="block text-xs text-muted-foreground">Maks. {s.capacity} orang · {full ? 'penuh' : `sisa ${s.seatsLeft} kursi`}</span>
                    <span className="mt-1 block font-bold text-brand">{formatRupiah(s.price)} <span className="text-xs font-normal text-muted-foreground">/ kendaraan</span></span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {slot && (
        <div className="checkout-panel">
          <div className="space-y-1.5">
            <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah penumpang</label>
            <PeopleStepper id="people" value={Math.min(people, Math.max(cap, 1))} onChange={setPeople} max={Math.max(cap, 1)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pickup" className="checkout-label">Detail penjemputan <span className="font-normal text-muted-foreground">(opsional)</span></label>
              <input id="pickup" className="checkout-input" maxLength={300} value={pickup} onChange={e => setPickup(e.target.value)} placeholder="Mis. nomor penerbangan / nama hotel" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="dropoff" className="checkout-label">Detail pengantaran <span className="font-normal text-muted-foreground">(opsional)</span></label>
              <input id="dropoff" className="checkout-input" maxLength={300} value={dropoff} onChange={e => setDropoff(e.target.value)} placeholder="Mis. nama hotel tujuan" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
