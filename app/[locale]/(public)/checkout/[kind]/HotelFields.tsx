'use client'

import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AlertTriangle, BedDouble, CalendarDays, UsersRound } from 'lucide-react'
import type { HotelCheckout } from '@/lib/checkout/options'
import { resolveHotelSchedule, roomsOf } from '@/lib/booking/hotelPick'
import { addDays, daysBetween, formatCalendarDate, isCalendarDate, DATE_LONG, type CalendarDate } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { CHECKOUT_MAX_NIGHTS, CHECKOUT_MAX_ROOMS } from '@/lib/validators/checkout'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { PeopleStepper } from './PeopleStepper'
import type { FieldsChange } from './fields'
import type { HotelPrefill } from '@/lib/checkout/prefill'

// Hotel (docs/arsitektur-booking-engine-v2.md §10.6): tipe kamar → check-in/check-out (periode harga dipilih OTOMATIS dari tanggal, seluruh malam harus dalam
// satu periode — aturan sama dengan mesin) → jumlah kamar & tamu. Jumlah malam dihitung server dari tanggal. Kamar kurang untuk jumlah tamu hanya
// DIINGATKAN (K11b-2 = a), tidak ditolak.
export function HotelFields({ product, today, maxPeople, onChange, initial = {} }: { product: HotelCheckout; today: string; maxPeople: number; onChange: FieldsChange; initial?: HotelPrefill }) {
  const t = useTranslations('checkout')
  const locale = useLocale()
  const rooms = useMemo(() => roomsOf(product.schedules, product.id), [product])
  // Tipe kamar dari kotak cari katalog dipakai hanya bila memang tipe kamar hotel ini.
  const [roomTypeId, setRoomTypeId] = useState(initial.room && rooms.some(r => r.id === initial.room) ? initial.room : rooms.length === 1 ? rooms[0]!.id : '')
  // Nilai mentah isian (saat tahun sedang diketik bisa "0002-12-11") — hitungan tanggal HANYA atas nilai yang sudah berupa tanggal kalender sah.
  // Isian awal dari kotak cari katalog (§9 H3): hanya petunjuk — periode/kamar tetap diperiksa di bawah dan oleh mesin pesan.
  const [rawIn, setCheckIn] = useState<string>(initial.checkIn ?? '')
  const [rawOut, setCheckOut] = useState<string>(initial.checkOut ?? '')
  const checkIn = isCalendarDate(rawIn) ? rawIn : ''
  const checkOut = isCalendarDate(rawOut) ? rawOut : ''
  const [numRooms, setNumRooms] = useState(Math.min(initial.rooms ?? 1, CHECKOUT_MAX_ROOMS))
  const [guests, setGuests] = useState(initial.guests ?? 1)

  const room = rooms.find(r => r.id === roomTypeId)
  const resolved = resolveHotelSchedule(product.schedules, product.id, roomTypeId, checkIn, checkOut)
  const schedule = resolved.ok ? resolved.schedule : null
  const nights = checkIn && checkOut ? daysBetween(checkIn, checkOut) : 0
  const roomCap = schedule ? Math.max(0, Math.min(CHECKOUT_MAX_ROOMS, schedule.roomsLeft)) : CHECKOUT_MAX_ROOMS
  const shortOfBeds = room ? numRooms * room.capacity < guests : false
  // Daftar periode berharga tipe kamar ini (pesan "tanggal di luar periode") — teks dirangkai di sini, bukan `noPeriodMessage` (bahasa admin).
  const periodList = (resolved.ok ? [] : resolved.periods)
    .map(p => `${formatCalendarDate(p.from as CalendarDate, DATE_LONG, locale)} – ${formatCalendarDate(p.to as CalendarDate, DATE_LONG, locale)}`).join('; ') || '—'

  useEffect(() => {
    if (product.schedules.length === 0) { onChange(null, t('hotel.missing.noRooms')); return }
    if (!roomTypeId) { onChange(null, t('hotel.missing.pickRoom')); return }
    if (!checkIn || !checkOut) { onChange(null, t('hotel.missing.pickDates')); return }
    if (checkIn < today) { onChange(null, t('hotel.missing.checkInPast')); return }
    if (nights < 1) { onChange(null, t('hotel.missing.checkOutAfter')); return }
    if (nights > CHECKOUT_MAX_NIGHTS) { onChange(null, t('hotel.missing.tooLong', { max: CHECKOUT_MAX_NIGHTS })); return }
    if (!schedule) { onChange(null, resolved.ok || resolved.periods.length === 0 ? t('hotel.missing.noPrice') : t('hotel.missing.noPeriod', { list: periodList })); return }
    if (roomCap < 1) { onChange(null, t('hotel.missing.full')); return }
    onChange({ kind: 'hotel', hotelRoomScheduleId: schedule.id, checkIn, checkOut, numRooms: Math.min(numRooms, roomCap), numGuests: guests }, null)
  }, [product, today, roomTypeId, checkIn, checkOut, nights, schedule, resolved, periodList, roomCap, numRooms, guests, onChange, t])

  return (
    <div className="space-y-5">
      <div className="checkout-panel">
        <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><BedDouble className="h-4 w-4 text-brand" aria-hidden /> {t('hotel.room')}</h2>
        {rooms.length > 0 ? (
          <div className="space-y-1.5">
            <label className="checkout-label">{t('hotel.roomType')}</label>
            <ChoiceSelect ariaLabel={t('hotel.roomType')} value={roomTypeId} onChange={setRoomTypeId} placeholder={t('hotel.pickRoom')} clearable={false}
              options={rooms.map(r => ({ id: r.id, label: t('hotel.roomOption', { name: r.name, capacity: r.capacity }), hint: `${r.minPrice === r.maxPrice ? formatRupiah(r.minPrice) : `${formatRupiah(r.minPrice)}–${formatRupiah(r.maxPrice)}`}${t('common.perNight')}` }))} />
          </div>
        ) : <p className="text-sm text-muted-foreground">{t('hotel.noRooms')}</p>}
      </div>

      {room && (
        <div className="checkout-panel">
          <h2 className="flex items-center gap-2 text-base font-bold text-brand-dark"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {t('hotel.stay')}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="checkin" className="checkout-label">{t('hotel.checkIn')}</label>
              <input id="checkin" type="date" className="checkout-input" value={rawIn} min={today}
                onChange={e => { const v = e.target.value; setCheckIn(v); if (isCalendarDate(v) && v >= today && (!checkOut || checkOut <= v)) setCheckOut(addDays(v, 1)) }} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="checkout" className="checkout-label">{t('hotel.checkOut')}</label>
              <input id="checkout" type="date" className="checkout-input" value={rawOut} min={checkIn ? addDays(checkIn, 1) : today} disabled={!checkIn} onChange={e => setCheckOut(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {schedule
              ? t('hotel.scheduleInfo', { nights, price: formatRupiah(schedule.price), rooms: schedule.roomsLeft })
              : t('hotel.periods', { list: periodList })}
          </p>
        </div>
      )}

      {schedule && (
        <div className="checkout-panel">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="rooms" className="checkout-label flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-brand" aria-hidden /> {t('hotel.rooms')}</label>
              <PeopleStepper id="rooms" value={Math.min(numRooms, Math.max(roomCap, 1))} onChange={setNumRooms} max={Math.max(roomCap, 1)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="guests" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {t('hotel.guests')}</label>
              <PeopleStepper id="guests" value={guests} onChange={setGuests} max={maxPeople} />
            </div>
          </div>
          {shortOfBeds && room && (
            <p role="status" className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {t('hotel.shortOfBeds', { rooms: numRooms, room: room.name, beds: numRooms * room.capacity, guests })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
