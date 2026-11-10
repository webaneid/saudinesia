'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BedDouble, CalendarDays, UsersRound } from 'lucide-react'
import type { HotelCheckout } from '@/lib/checkout/options'
import { noPeriodMessage, resolveHotelSchedule, roomsOf } from '@/lib/booking/hotelPick'
import { addDays, daysBetween, formatCalendarDate, isCalendarDate, DATE_LONG, type CalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { CHECKOUT_MAX_NIGHTS, CHECKOUT_MAX_ROOMS } from '@/lib/validators/checkout'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'

// Hotel (docs/arsitektur-booking-engine-v2.md §10.6): tipe kamar → check-in/check-out (periode harga dipilih OTOMATIS dari tanggal, seluruh malam harus dalam
// satu periode — aturan sama dengan mesin) → jumlah kamar & tamu. Jumlah malam dihitung server dari tanggal. Kamar kurang untuk jumlah tamu hanya
// DIINGATKAN (K11b-2 = a), tidak ditolak.
export function HotelFields({ product, today, maxPeople, onChange }: { product: HotelCheckout; today: string; maxPeople: number; onChange: FieldsChange }) {
  const rooms = useMemo(() => roomsOf(product.schedules, product.id), [product])
  const [roomTypeId, setRoomTypeId] = useState(rooms.length === 1 ? rooms[0]!.id : '')
  // Nilai mentah isian (saat tahun sedang diketik bisa "0002-12-11") — hitungan tanggal HANYA atas nilai yang sudah berupa tanggal kalender sah.
  const [rawIn, setCheckIn] = useState('')
  const [rawOut, setCheckOut] = useState('')
  const checkIn = isCalendarDate(rawIn) ? rawIn : ''
  const checkOut = isCalendarDate(rawOut) ? rawOut : ''
  const [numRooms, setNumRooms] = useState(1)
  const [guests, setGuests] = useState(1)

  const room = rooms.find(r => r.id === roomTypeId)
  const resolved = resolveHotelSchedule(product.schedules, product.id, roomTypeId, checkIn, checkOut)
  const schedule = resolved.ok ? resolved.schedule : null
  const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0
  const roomCap = schedule ? Math.max(0, Math.min(CHECKOUT_MAX_ROOMS, schedule.roomsLeft)) : CHECKOUT_MAX_ROOMS
  const shortOfBeds = room ? numRooms * room.capacity < guests : false

  useEffect(() => {
    if (product.schedules.length === 0) { onChange(null, 'Belum ada kamar yang dapat dipesan di hotel ini'); return }
    if (!roomTypeId) { onChange(null, 'Pilih tipe kamar'); return }
    if (!checkIn || !checkOut) { onChange(null, 'Pilih tanggal check-in dan check-out'); return }
    if (checkIn < today) { onChange(null, 'Tanggal check-in tidak boleh sebelum hari ini'); return }
    if (nights < 1) { onChange(null, 'Tanggal check-out harus setelah check-in'); return }
    if (nights > CHECKOUT_MAX_NIGHTS) { onChange(null, `Maksimal ${CHECKOUT_MAX_NIGHTS} malam per pesanan`); return }
    if (!schedule) { onChange(null, noPeriodMessage(resolved.ok ? [] : resolved.periods)); return }
    if (roomCap < 1) { onChange(null, 'Kamar ini sudah penuh untuk periode tersebut'); return }
    onChange({ kind: 'hotel', hotelRoomScheduleId: schedule.id, checkIn, checkOut, numRooms: Math.min(numRooms, roomCap), numGuests: guests }, null)
  }, [product, today, roomTypeId, checkIn, checkOut, nights, schedule, resolved, roomCap, numRooms, guests, onChange])

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><BedDouble className="h-4 w-4 text-brand" aria-hidden /> Kamar</h2>
        {rooms.length > 0 ? (
          <div className="space-y-1.5">
            <label className="checkout-label">Tipe kamar</label>
            <ChoiceSelect ariaLabel="Tipe kamar" value={roomTypeId} onChange={setRoomTypeId} placeholder="Pilih tipe kamar" clearable={false}
              options={rooms.map(r => ({ id: r.id, label: `${r.name} · maks. ${r.capacity} orang`, hint: r.minPrice === r.maxPrice ? `${formatRupiah(r.minPrice)}/malam` : `${formatRupiah(r.minPrice)}–${formatRupiah(r.maxPrice)}/malam` }))} />
          </div>
        ) : <p className="text-sm text-muted-foreground">Belum ada kamar yang dapat dipesan — hubungi kami.</p>}
      </div>

      {room && (
        <div className="checkout-panel">
          <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> Tanggal menginap</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="checkin" className="checkout-label">Check-in</label>
              <input id="checkin" type="date" className="checkout-input" value={rawIn} min={today}
                onChange={e => { const v = e.target.value; setCheckIn(v); if (isCalendarDate(v) && v >= today && (!checkOut || checkOut <= v)) setCheckOut(addDays(v, 1)) }} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="checkout" className="checkout-label">Check-out</label>
              <input id="checkout" type="date" className="checkout-input" value={rawOut} min={checkIn ? addDays(checkIn, 1) : today} disabled={!checkIn} onChange={e => setCheckOut(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {schedule
              ? `${nights} malam · harga ${formatRupiah(schedule.price)}/kamar/malam · sisa ${schedule.roomsLeft} kamar`
              : `Periode tersedia: ${(resolved.ok ? [] : resolved.periods).map(p => `${formatCalendarDate(p.from as CalendarDate, DATE_LONG)} – ${formatCalendarDate(p.to as CalendarDate, DATE_LONG)}`).join('; ') || '—'}`}
          </p>
        </div>
      )}

      {schedule && (
        <div className="checkout-panel">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rooms" className="checkout-label flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-brand" aria-hidden /> Jumlah kamar</label>
              <PeopleStepper id="rooms" value={Math.min(numRooms, Math.max(roomCap, 1))} onChange={setNumRooms} max={Math.max(roomCap, 1)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="guests" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> Jumlah tamu</label>
              <PeopleStepper id="guests" value={guests} onChange={setGuests} max={maxPeople} />
            </div>
          </div>
          {shortOfBeds && room && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {numRooms} kamar {room.name} memuat {numRooms * room.capacity} orang, sedangkan tamu {guests} orang. Pastikan jumlah kamar cukup — pesanan tetap dapat dibuat.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
