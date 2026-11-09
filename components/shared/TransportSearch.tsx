'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Plane, Route as RouteIcon, Landmark, Bus, CarFront, Users,
  ArrowRightLeft, ArrowRight, SearchX,
} from 'lucide-react'
import { formatRupiah } from '@/lib/utils'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { FilterSelect } from '@/components/shared/data-table/FilterSelect'

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

/** Teks dari halaman server (berkas pesan / Konten Situs) — komponen klien tidak membaca pesan sendiri. */
export type TransportSearchLabels = {
  where: string; from: string; to: string; anyOrigin: string; anyDestination: string; swap: string
  category: string; all: string; empty: string; reset: string; order: string
  /** Sudah diformat per kendaraan: kapasitas → teks. */
  capacity: Record<number, string>
  categories: Record<string, string>
}

type Props = { trips: TripData[]; locale: string; labels: TransportSearchLabels }

const CATEGORY_ICON: Record<string, React.ElementType> = {
  airport: Plane, intercity: RouteIcon, city_tour: Landmark, shuttle: Bus, other: RouteIcon,
}

const VEHICLE_ICON: Record<string, React.ElementType> = {
  bus: Bus, coaster: Bus, hiace: CarFront, staria: CarFront,
  gmc: CarFront, innova: CarFront, sedan: CarFront,
}

// Pencarian rute katalog Transport (rute dulu, baru kendaraan — docs/decisions.md 2026-07-20). Warna hanya token brand (§6.7 G3).
export default function TransportSearch({ trips, locale, labels }: Props) {
  const [origin, setOrigin]     = useState('')
  const [destination, setDest]  = useState('')
  const [category, setCategory] = useState('')

  const origins      = useMemo(() => [...new Set(trips.map(t => t.origin))].sort(), [trips])
  const destinations = useMemo(() => [...new Set(trips.map(t => t.destination))].sort(), [trips])
  const categories   = useMemo(() => [...new Set(trips.map(t => t.category).filter((c): c is string => !!c))], [trips])
  const categoryLabel = (c: string) => labels.categories[c] ?? c

  const filtered = useMemo(() => trips.filter(t =>
    (!origin || t.origin === origin) &&
    (!destination || t.destination === destination) &&
    (!category || t.category === category)
  ), [trips, origin, destination, category])

  const hasFilter = !!(origin || destination || category)

  function swap() {
    setOrigin(destination)
    setDest(origin)
  }

  function reset() {
    setOrigin(''); setDest(''); setCategory('')
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 rounded-2xl border bg-card p-5">
        <p className="text-sm font-semibold text-brand-dark">{labels.where}</p>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block text-xs text-muted-foreground">{labels.from}</span>
            <ChoiceSelect ariaLabel={labels.from} placeholder={labels.anyOrigin} value={origin} onChange={setOrigin} options={origins.map(o => ({ id: o, label: o }))} />
          </div>
          <button
            type="button" onClick={swap} aria-label={labels.swap}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border text-muted-foreground transition-colors hover:border-brand hover:text-brand"
          >
            <ArrowRightLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1 space-y-1">
            <span className="block text-xs text-muted-foreground">{labels.to}</span>
            <ChoiceSelect ariaLabel={labels.to} placeholder={labels.anyDestination} value={destination} onChange={setDest} options={destinations.map(d => ({ id: d, label: d }))} />
          </div>
        </div>
        {categories.length > 1 && (
          <FilterSelect
            label={labels.category}
            allLabel={labels.all}
            options={categories.map(c => ({ value: c, label: categoryLabel(c) }))}
            value={category}
            onChange={setCategory}
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="space-y-3 rounded-2xl border border-dashed p-12 text-center text-muted-foreground">
          <SearchX className="mx-auto h-10 w-10 opacity-30" />
          <p>{labels.empty}</p>
          {hasFilter && (
            <button type="button" onClick={reset} className="text-sm font-semibold text-brand hover:underline">
              {labels.reset}
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-5">
          {filtered.map(trip => {
            const Icon = CATEGORY_ICON[trip.category ?? 'other'] ?? RouteIcon
            const bookable = trip.vehicles.some(v => v.price > 0)
            return (
              <article key={trip.id} className="catalog-card gap-4 p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-light">
                    <Icon className="h-5 w-5 text-brand" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    {trip.category && <span className="catalog-chip">{categoryLabel(trip.category)}</span>}
                    <h3 className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-brand-dark">
                      {trip.origin} <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden /> {trip.destination}
                    </h3>
                    {trip.description && <p className="text-sm text-muted-foreground">{trip.description}</p>}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {trip.vehicles.map(v => {
                    const VIcon = VEHICLE_ICON[v.vehicleType] ?? CarFront
                    return (
                      <div key={v.pricingId} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                        {v.coverUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- URL presigned MinIO (bucket private), sudah dikecilkan saat unggah
                          <img src={v.coverUrl} alt={v.vehicleName} loading="lazy" decoding="async" className="h-9 w-9 shrink-0 rounded-md object-cover" />
                        ) : (
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted">
                            <VIcon className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">{v.vehicleName}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Users className="h-3 w-3" aria-hidden /> {labels.capacity[v.capacity] ?? v.capacity}
                          </p>
                        </div>
                        {v.price > 0 && <p className="shrink-0 text-sm font-semibold text-brand">{formatRupiah(v.price)}</p>}
                      </div>
                    )
                  })}
                </div>

                {bookable && (
                  <div className="mt-auto border-t pt-4">
                    <Link href={`/${locale}/bookings/checkout/transport?tripId=${trip.id}`} className="btn-brand-solid w-full sm:w-auto">
                      {labels.order} <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
