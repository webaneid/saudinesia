'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft, CalendarDays, PlaneLanding, PlaneTakeoff, Search, UsersRound } from 'lucide-react'
import { isCalendarDate } from '@/lib/time'
import { AutocompleteSelect } from '@/components/shared/AutocompleteSelect'
import { PeopleStepper } from '../checkout/[kind]/PeopleStepper'

/** Teks dari halaman server (Konten Situs / berkas pesan) — komponen klien katalog tidak membaca pesan sendiri (§6.8). */
export type FlightSearchLabels = {
  from: string; to: string; anyOrigin: string; anyDestination: string; swap: string
  date: string; returnDate: string; returnOptional: string; passengers: string; submit: string
  needDate: string; datePast: string; returnBefore: string
}

export type FlightSearchValue = { from: string; to: string; date: string; ret: string; pax: number }

type Props = {
  locale: string
  /** Rute aktif yang masih punya jadwal (asal → tujuan). */
  routes: ReadonlyArray<{ origin: string; destination: string }>
  initial: FlightSearchValue
  today: string
  maxPeople: number
  labels: FlightSearchLabels
}

// Kotak cari tiket pesawat di hero (docs/arsitektur-frontend-publik.md §9 H2): asal → tujuan (dropdown pencarian dari rute aktif), tanggal berangkat,
// tanggal pulang opsional, jumlah jamaah. Mengirim GET ke halaman katalog yang sama (parameter di URL, disaring server dengan daftar putih).
export function FlightSearch({ locale, routes, initial, today, maxPeople, labels }: Props) {
  const router = useRouter()
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)
  const [date, setDate] = useState(initial.date)
  const [ret, setRet] = useState(initial.ret)
  const [pax, setPax] = useState(initial.pax)
  const [error, setError] = useState<string | null>(null)

  const origins = [...new Set(routes.filter(r => !to || r.destination === to).map(r => r.origin))].sort()
  const destinations = [...new Set(routes.filter(r => !from || r.origin === from).map(r => r.destination))].sort()
  const canSwap = routes.some(r => r.origin === to && r.destination === from)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!isCalendarDate(date)) { setError(labels.needDate); return }
    if (date < today) { setError(labels.datePast); return }
    if (ret && (!isCalendarDate(ret) || ret < date)) { setError(labels.returnBefore); return }
    setError(null)
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    q.set('date', date)
    if (ret) q.set('ret', ret)
    q.set('pax', String(pax))
    router.push(`/${locale}/flight?${q.toString()}#catalog`)
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {/* Baris 1: kota asal ⇄ tujuan. Baris 2: tanggal, pulang, jamaah, tombol — dua baris supaya nama kota tak terpotong di layar lebar. */}
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-end">
        <div className="min-w-0 space-y-1.5">
          <span className="checkout-label flex items-center gap-1.5"><PlaneTakeoff className="h-4 w-4 text-brand" aria-hidden /> {labels.from}</span>
          <AutocompleteSelect ariaLabel={labels.from} placeholder={labels.anyOrigin} value={from || null} searchable
            onChange={v => setFrom(v ?? '')} options={origins.map(o => ({ id: o, label: o }))} />
        </div>
        <button type="button" onClick={() => { setFrom(to); setTo(from) }} disabled={!canSwap} aria-label={labels.swap}
          className="hidden h-11 w-11 place-items-center rounded-full border text-muted-foreground transition-colors hover:border-brand hover:text-brand disabled:opacity-40 md:grid">
          <ArrowRightLeft className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 space-y-1.5">
          <span className="checkout-label flex items-center gap-1.5"><PlaneLanding className="h-4 w-4 text-brand" aria-hidden /> {labels.to}</span>
          <AutocompleteSelect ariaLabel={labels.to} placeholder={labels.anyDestination} value={to || null} searchable
            onChange={v => setTo(v ?? '')} options={destinations.map(d => ({ id: d, label: d }))} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] lg:items-end">
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="flight-date" className="checkout-label flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {labels.date}</label>
          <input id="flight-date" type="date" className="checkout-input" value={date} min={today} onChange={e => { setDate(e.target.value); setError(null) }} />
        </div>
        <div className="min-w-0 space-y-1.5">
          <label htmlFor="flight-return" className="checkout-label flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-brand" aria-hidden /> {labels.returnDate} <span className="font-normal text-muted-foreground">{labels.returnOptional}</span>
          </label>
          <input id="flight-return" type="date" className="checkout-input" value={ret} min={date || today} onChange={e => { setRet(e.target.value); setError(null) }} />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="flight-pax" className="checkout-label flex items-center gap-1.5"><UsersRound className="h-4 w-4 text-brand" aria-hidden /> {labels.passengers}</label>
          <PeopleStepper id="flight-pax" value={pax} onChange={setPax} max={maxPeople} />
        </div>
        <button type="submit" className="btn-brand-solid sm:col-span-2 lg:col-span-1">
          <Search className="h-4 w-4" aria-hidden /> {labels.submit}
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  )
}
