'use client'

import { useEffect, useMemo, useState } from 'react'
import { Bus, CalendarDays, CheckCircle2, Hotel, Landmark, UsersRound } from 'lucide-react'
import type { TourCheckout } from '@/lib/checkout/options'
import { DATE_LONG, formatCalendarDate, type CalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { CHECKOUT_MAX_ROOMS } from '@/lib/validators/checkout'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import { priceHint, type FieldsChange } from './fields'

// Paket Ziarah (docs/arsitektur-booking-engine-v2.md §10.6, docs/arsitektur-ziarah.md §12): harga PER PAKET. Kendaraan `included` → hanya tanggal yang punya
// kuota kendaraan paket (dicari otomatis oleh mesin); `user_choice` → tanggal bebas lalu kendaraan pilihan di tanggal itu (opsional, ditagih terpisah);
// hotel `user_choice` → hotel + jumlah kamar (opsional). Tanggal tur = tanggal kuota kendaraan bila ada.
export function TourFields({ product, today, maxPeople, onChange }: { product: TourCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const included = product.transportMode === 'included'
  const dates = useMemo(() => [...new Set(product.slots.filter(s => s.seatsLeft > 0).map(s => s.date))], [product])
  const [date, setDate] = useState(included && dates.length === 1 ? dates[0]! : '')
  const [quotaId, setQuotaId] = useState('')
  const [people, setPeople] = useState(1)
  const [hotelId, setHotelId] = useState('')
  const [hotelRooms, setHotelRooms] = useState(1)

  const daySlots = product.slots.filter(s => s.date === date)
  const chosen = included ? daySlots[0] : daySlots.find(s => s.quotaId === quotaId)
  const cap = chosen ? Math.max(0, Math.min(maxPeople, included ? chosen.seatsLeft : Math.min(chosen.capacity, chosen.seatsLeft))) : maxPeople
  const hotel = product.hotelOptions.find(h => h.id === hotelId)
  const roomCap = hotel ? Math.max(0, Math.min(CHECKOUT_MAX_ROOMS, hotel.roomsLeft)) : CHECKOUT_MAX_ROOMS

  useEffect(() => {
    if (product.blocked) { onChange(null, product.blocked); return }
    if (!date) { onChange(null, 'Pilih tanggal tur'); return }
    if (date < today) { onChange(null, 'Tanggal tur tidak boleh sebelum hari ini'); return }
    if (included && !chosen) { onChange(null, 'Kendaraan paket tidak tersedia di tanggal itu'); return }
    if (cap < 1) { onChange(null, 'Kursi kendaraan sudah penuh di tanggal itu'); return }
    if (hotel && roomCap < 1) { onChange(null, 'Kamar hotel pilihan sudah penuh'); return }
    onChange({
      kind: 'tour', tourPackageId: product.id, tourDate: date, numPeople: Math.min(people, cap),
      ...(!included && chosen ? { transportQuotaId: chosen.quotaId } : {}),
      ...(hotel ? { chosenHotelRoomScheduleId: hotel.id, chosenHotelNumRooms: Math.min(hotelRooms, roomCap) } : {}),
    }, null)
  }, [product, included, date, today, chosen, cap, people, hotel, hotelRooms, roomCap, onChange])

  const includes = [
    ...product.sites.map(s => ({ icon: Landmark, text: s })),
    ...(product.includedVehicle ? [{ icon: Bus, text: `Kendaraan: ${product.includedVehicle}` }] : []),
    ...product.includedHotels.map(h => ({ icon: Hotel, text: h })),
  ]

  return (
    <div className="space-y-5">
      {includes.length > 0 && (
        <div className="checkout-panel">
          <h2 className="text-base font-bold text-brand-dark">Sudah termasuk</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {includes.map(x => <li key={x.text} className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 shrink-0 text-brand" aria-hidden /> {x.text}</li>)}
          </ul>
        </div>
      )}

      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Jadwal & jumlah orang</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="tour-date" className="checkout-label">Tanggal tur</label>
            {included
              ? <ChoiceSelect ariaLabel="Tanggal tur" value={date} onChange={setDate} placeholder="Pilih tanggal" clearable={false}
                  options={dates.map(d => ({ id: d, label: formatCalendarDate(d as CalendarDate, DATE_LONG) }))} />
              : <input id="tour-date" type="date" className="checkout-input" value={date} min={today} onChange={e => { setDate(e.target.value); setQuotaId('') }} />}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="people" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah orang</label>
            <PeopleStepper id="people" value={Math.min(people, Math.max(cap, 1))} onChange={setPeople} max={Math.max(cap, 1)} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Harga paket berlaku per rombongan{chosen && included ? ` · sisa ${chosen.seatsLeft} kursi` : ''}.</p>
      </div>

      {product.transportMode === 'user_choice' && date && (
        <div className="checkout-panel">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><Bus className="h-4 w-4 text-brand" aria-hidden /> Kendaraan <span className="font-normal text-muted-foreground">(opsional)</span></h2>
            <p className="text-sm text-muted-foreground">Ditagih per kendaraan, terpisah dari harga paket.</p>
          </div>
          {daySlots.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kendaraan">
              {daySlots.map(s => {
                const full = s.seatsLeft < 1
                const active = s.quotaId === quotaId
                return (
                  <button key={s.quotaId} type="button" role="radio" aria-checked={active} disabled={full} onClick={() => setQuotaId(active ? '' : s.quotaId)}
                    className={`checkout-option disabled:opacity-50 ${active ? 'border-brand bg-brand-light' : ''}`}>
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-light"><Bus className="h-5 w-5 text-brand" aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{s.vehicle}</span>
                      <span className="block text-xs text-muted-foreground">Maks. {s.capacity} orang · {full ? 'penuh' : `sisa ${s.seatsLeft} kursi`}</span>
                      <span className="mt-1 block font-bold text-brand">{formatRupiah(s.price)} <span className="text-xs font-normal text-muted-foreground">/ kendaraan</span></span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : <p className="text-sm text-muted-foreground">Tidak ada kendaraan terjadwal di tanggal ini — paket tetap dapat dipesan tanpa kendaraan.</p>}
        </div>
      )}

      {product.hotelOptions.length > 0 && (
        <div className="checkout-panel">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><Hotel className="h-4 w-4 text-brand" aria-hidden /> Hotel <span className="font-normal text-muted-foreground">(opsional)</span></h2>
            <p className="text-sm text-muted-foreground">Ditagih per kamar per malam, terpisah dari harga paket.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="checkout-label">Hotel pilihan</label>
              <ChoiceSelect ariaLabel="Hotel pilihan" value={hotelId} onChange={setHotelId} placeholder="Tanpa hotel"
                options={product.hotelOptions.map(h => ({ id: h.id, label: `${h.label} (${h.nights} malam)`, hint: priceHint(h.pricePerNight, '/malam') }))} />
            </div>
            {hotel && (
              <div className="space-y-1.5">
                <label htmlFor="hotel-rooms" className="checkout-label">Jumlah kamar</label>
                <PeopleStepper id="hotel-rooms" value={Math.min(hotelRooms, Math.max(roomCap, 1))} onChange={setHotelRooms} max={Math.max(roomCap, 1)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
