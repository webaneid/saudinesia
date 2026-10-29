'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Plane, Route as RouteIcon, Landmark, Bus, CarFront, Users,
  ArrowRightLeft, ArrowRight, Search, SearchX,
} from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

export type VehicleOption = {
  pricingId:   string
  vehicleId:   string
  vehicleName: string
  vehicleType: string
  capacity:    number
  fleetCount:  number
  price:       number
  coverUrl:    string | null
}

export type TripData = {
  id:          string
  name:        string
  category:    string | null
  description: string | null
  origin:      string
  destination: string
  vehicles:    VehicleOption[]
}

type Props = { trips: TripData[]; locale: string }

const CATEGORY_LABEL: Record<string, string> = {
  airport:   'Jemput Bandara',
  intercity: 'Antar Kota',
  city_tour: 'City Tour',
  shuttle:   'Shuttle',
  other:     'Lainnya',
}

const CATEGORY_ICON: Record<string, React.ElementType> = {
  airport: Plane, intercity: RouteIcon, city_tour: Landmark, shuttle: Bus, other: RouteIcon,
}

const VEHICLE_ICON: Record<string, React.ElementType> = {
  bus: Bus, coaster: Bus, hiace: CarFront, staria: CarFront,
  gmc: CarFront, innova: CarFront, sedan: CarFront,
}

export default function TransportSearch({ trips, locale }: Props) {
  const [origin, setOrigin]     = useState('')
  const [destination, setDest]  = useState('')
  const [category, setCategory] = useState('all')

  const origins      = useMemo(() => [...new Set(trips.map(t => t.origin))].sort(), [trips])
  const destinations  = useMemo(() => [...new Set(trips.map(t => t.destination))].sort(), [trips])
  const categories    = useMemo(() => [...new Set(trips.map(t => t.category).filter((c): c is string => !!c))], [trips])

  const filtered = useMemo(() => trips.filter(t =>
    (!origin || t.origin === origin) &&
    (!destination || t.destination === destination) &&
    (category === 'all' || t.category === category)
  ), [trips, origin, destination, category])

  const hasFilter = origin || destination || category !== 'all'

  function swap() {
    setOrigin(destination)
    setDest(origin)
  }

  function reset() {
    setOrigin(''); setDest(''); setCategory('all')
  }

  return (
    <div className="space-y-6">
      {/* Route finder */}
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Mau ke mana?</p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block text-[11px] text-muted-foreground">Dari</span>
            <ChoiceSelect ariaLabel="Dari" placeholder="Semua titik jemput" value={origin} onChange={setOrigin} options={origins.map(o => ({ id: o, label: o }))} />
          </div>
          <button
            type="button" onClick={swap} aria-label="Tukar titik jemput dan tujuan"
            className="shrink-0 h-10 w-10 rounded-full border grid place-items-center text-muted-foreground hover:text-teal-600 hover:border-teal-300 transition-colors"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block text-[11px] text-muted-foreground">Ke</span>
            <ChoiceSelect ariaLabel="Ke" placeholder="Semua tujuan" value={destination} onChange={setDest} options={destinations.map(d => ({ id: d, label: d }))} />
          </div>
        </div>
      </div>

      {/* Category quick filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => setCategory('all')}
          className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
            category === 'all' ? 'bg-teal-50 border-teal-200 text-teal-700' : 'text-muted-foreground hover:border-teal-200'
          }`}
        >
          <Search className="h-3.5 w-3.5" /> Semua
        </button>
        {categories.map(c => {
          const Icon = CATEGORY_ICON[c] ?? RouteIcon
          return (
            <button
              key={c} onClick={() => setCategory(c)}
              className={`shrink-0 flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                category === c ? 'bg-teal-50 border-teal-200 text-teal-700' : 'text-muted-foreground hover:border-teal-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {CATEGORY_LABEL[c] ?? c}
            </button>
          )
        })}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground space-y-3">
          <SearchX className="h-10 w-10 mx-auto opacity-30" />
          <p>Tidak ada rute yang cocok dengan pilihanmu.</p>
          {hasFilter && (
            <button onClick={reset} className="text-sm text-teal-600 font-medium hover:underline">
              Reset pencarian
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(trip => {
            const Icon = CATEGORY_ICON[trip.category ?? 'other'] ?? RouteIcon
            return (
              <div key={trip.id} className="rounded-xl border bg-card p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-teal-50 grid place-items-center shrink-0">
                    <Icon className="h-5 w-5 text-teal-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-foreground flex flex-wrap items-center gap-1.5">
                      {trip.origin} <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> {trip.destination}
                    </p>
                    {trip.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{trip.description}</p>
                    )}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-2">
                  {trip.vehicles.map(v => {
                    const VIcon = VEHICLE_ICON[v.vehicleType] ?? CarFront
                    return (
                      <div key={v.pricingId} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                        {v.coverUrl ? (
                          <Image src={v.coverUrl} alt={v.vehicleName} width={36} height={36}
                            className="h-9 w-9 rounded-md object-cover shrink-0" unoptimized />
                        ) : (
                          <div className="h-9 w-9 rounded-md bg-slate-100 grid place-items-center shrink-0">
                            <VIcon className="h-4 w-4 text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-foreground truncate">{v.vehicleName}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                            <Users className="h-3 w-3" /> {v.capacity} org
                          </p>
                        </div>
                        {v.price > 0 && (
                          <p className="text-[13px] font-semibold text-teal-700 shrink-0">{formatRupiah(v.price)}</p>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="pt-1 border-t">
                  <Link href={`/${locale}/bookings/checkout/transport?tripId=${trip.id}`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 hover:text-teal-700">
                    Pesan sekarang <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
