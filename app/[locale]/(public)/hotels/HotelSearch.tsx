'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BedDouble, CalendarDays, MapPin, Search, UsersRound } from 'lucide-react'
import { addDays, daysBetween, isCalendarDate } from '@/lib/time'
import { AutocompleteSelect } from '@/components/shared/AutocompleteSelect'
import { PeopleStepper } from '../checkout/[kind]/PeopleStepper'

/** Teks dari halaman server (Konten Situs / berkas pesan) — komponen klien katalog tidak membaca pesan sendiri (§6.8). */
export type HotelSearchLabels = {
  city: string; anyCity: string; checkIn: string; checkOut: string; rooms: string; guests: string; submit: string
  needDates: string; checkInPast: string; checkOutAfter: string; tooLong: string
}

export type HotelSearchValue = { city: string; checkIn: string; checkOut: string; rooms: number; guests: number }

type Props = {
  locale: string
  /** Kota yang punya hotel aktif (nilai + label dalam bahasa halaman). */
  cities: ReadonlyArray<{ value: string; label: string }>
  initial: HotelSearchValue
  today: string
  maxRooms: number
  maxGuests: number
  maxNights: number
  labels: HotelSearchLabels
}

// Kotak cari hotel di hero (docs/arsitektur-frontend-publik.md §9 H3): kota (dropdown pencarian), check-in, check-out, kamar, tamu.
// Mengirim GET ke halaman katalog yang sama (parameter di URL, disaring server dengan daftar putih).
export function HotelSearch({ locale, cities, initial, today, maxRooms, maxGuests, maxNights, labels }: Props) {
  const router = useRouter()
  const [city, setCity] = useState(initial.city)
  const [checkIn, setCheckIn] = useState(initial.checkIn)
  const [checkOut, setCheckOut] = useState(initial.checkOut)
  const [rooms, setRooms] = useState(initial.rooms)
  const [guests, setGuests] = useState(initial.guests)
  const [error, setError] = useState<string | null>(null)

  function pickCheckIn(v: string) {
    setCheckIn(v)
    setError(null)
    // Check-out ikut maju satu malam bila kosong atau tidak lagi sesudah check-in (pola sama dengan formulir checkout).
    if (isCalendarDate(v) && v >= today && (!isCalendarDate(checkOut) || checkOut <= v)) setCheckOut(addDays(v, 1))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) { setError(labels.needDates); return }
    if (checkIn < today) { setError(labels.checkInPast); return }
    if (checkOut <= checkIn) { setError(labels.checkOutAfter); return }
    if (daysBetween(checkIn, checkOut) > maxNights) { setError(labels.tooLong); return }
    setError(null)
    const q = new URLSearchParams()
    if (city) q.set('city', city)
    q.set('checkIn', checkIn)
    q.set('checkOut', checkOut)
    q.set('rooms', String(rooms))
    q.set('guests', String(guests))
    router.push(`/${locale}/hotels?${q.toString()}#catalog`)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {/* Baris 1: kota, check-in, check-out. Baris 2: kamar, tamu, tombol. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0 space-y-1.5 sm:col-span-2 lg:col-span-1">
          <span className="checkout-label flex items-center gap-1.5"><MapPin className="h-4 w-4 text-brand" aria-hidden /> {labels.city}</span>
          <AutocompleteSelect ariaLabel={labels.city} placeholder={labels.anyCity} value={city || null} searchable
            onChange={v => setCity(v ?? '')} options={cities.map(c => ({ id: c.value, label: c.label }))} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="hotel-checkin" className="checkout-label flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {labels.checkIn}</label>
          <input id="hotel-checkin" type="date" className="checkout-input" value={checkIn} min={today} onChange={e => pickCheckIn(e.target.value)} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="hotel-checkout" className="checkout-label flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {labels.checkOut}</label>
          <input id="hotel-checkout" type="date" className="checkout-input" value={checkOut} min={isCalendarDate(checkIn) ? addDays(checkIn, 1) : today}
            onChange={e => { setCheckOut(e.target.value); setError(null) }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[auto_auto_minmax(0,1fr)] lg:items-end">
        <div className="space-y-1.5">
          <label htmlFor="hotel-rooms" className="checkout-label flex items-center gap-1.5"><BedDouble className="h-4 w-4 text-brand" aria-hidden /> {labels.rooms}</label>
          <PeopleStepper id="hotel-rooms" value={rooms} onChange={setRooms} max={maxRooms} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="hotel-guests" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {labels.guests}</label>
          <PeopleStepper id="hotel-guests" value={guests} onChange={setGuests} max={maxGuests} />
        </div>
        <button type="submit" className="btn-brand-solid col-span-2 lg:col-span-1">
          <Search className="h-4 w-4" aria-hidden /> {labels.submit}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
