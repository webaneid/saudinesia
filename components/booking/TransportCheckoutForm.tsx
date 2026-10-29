'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Trash2, UserRound, Bus, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatRupiah, cn } from '@/lib/utils'
import { ManifestFieldsForm, type ManifestField, type PhoneValue } from '@/components/booking/ManifestFieldsForm'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

type TripOption = { id: string; name: string; category: string | null; origin: string; destination: string }
type VehicleOption = {
  quotaId: string; vehicleId: string; vehicleName: string; vehicleType: string
  capacity: number; price: number; availableSeats: number
}
type CheckoutPilgrim = { tempId: string; fieldValues: Record<string, unknown> }

function makePilgrim(): CheckoutPilgrim {
  return { tempId: crypto.randomUUID(), fieldValues: {} }
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (typeof v === 'object' && v !== null && 'number' in (v as object)) return !(v as PhoneValue).number
  return false
}

// docs/arsitektur-booking.md §6 Step 6c — checkout pendek Transport-only. State LOKAL (bukan
// draft.ts) — pilgrim TIDAK punya visaProductId sama sekali (§6a), manifest pakai field "core".
export function TransportCheckoutForm({ trips, preselectedTripId }: { trips: TripOption[]; preselectedTripId: string | null }) {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()

  const [tripId, setTripId]   = useState(preselectedTripId ?? trips[0]?.id ?? '')
  const [travelDate, setTravelDate] = useState('')
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])
  const [quotaId,  setQuotaId]  = useState('')
  const [pickupDetail,  setPickupDetail]  = useState('')
  const [dropoffDetail, setDropoffDetail] = useState('')
  const [pilgrims, setPilgrims] = useState<CheckoutPilgrim[]>([makePilgrim()])
  const [coreFields, setCoreFields] = useState<ManifestField[] | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    fetch(`/api/v1/manifest/requirements?productType=${CORE_MANIFEST_PRODUCT_TYPE}&productId=${CORE_MANIFEST_PRODUCT_ID}`)
      .then(r => r.json()).then(j => setCoreFields(j.data ?? []))
  }, [])

  useEffect(() => {
    setQuotaId('')
    setVehicles([])
    if (!tripId || !travelDate) return
    fetch(`/api/v1/catalog/transport?tripId=${tripId}&date=${travelDate}`)
      .then(r => r.json())
      .then(j => setVehicles((j.data ?? []) as VehicleOption[]))
  }, [tripId, travelDate])

  const numPassengers = pilgrims.length

  function updateFieldValues(idx: number, values: Record<string, unknown>) {
    setPilgrims(prev => prev.map((p, i) => i === idx ? { ...p, fieldValues: values } : p))
  }
  function addPilgrim() { setPilgrims(prev => [...prev, makePilgrim()]) }
  function removePilgrim(idx: number) { setPilgrims(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev) }

  function pilgrimErrors(idx: number): Record<string, string> {
    const prefix = `${idx}-`
    return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!travelDate) errs.date = 'Pilih tanggal perjalanan'
    if (!quotaId) errs.vehicle = 'Pilih kendaraan'
    const fields = coreFields ?? []
    pilgrims.forEach((p, i) => {
      for (const f of fields) {
        if (!f.required) continue
        if (isEmptyValue(p.fieldValues[f.fieldKey])) errs[`${i}-${f.fieldKey}`] = `${f.label} wajib diisi`
      }
    })
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit() {
    setSubmitError('')
    if (!validate()) return
    setLoading(true)
    try {
      const res = await fetch('/api/v1/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          departureDate: travelDate, returnDate: travelDate, season: 'regular',
          bookingType: pilgrims.length > 1 ? 'group' : 'individual',
          totalPilgrims: pilgrims.length,
          items: [{
            itemType: 'transport', transportQuotaId: quotaId, numPassengers,
            pickupDetail: pickupDetail || undefined, dropoffDetail: dropoffDetail || undefined,
          }],
          // Tidak ada key visaProductId sama sekali — docs/arsitektur-booking.md §6a, pilgrim
          // Transport-only tidak dipaksa punya visa.
          pilgrims: pilgrims.map(p => ({ fieldValues: p.fieldValues })),
        }),
      })
      const json = await res.json()
      if (!json.success) { setSubmitError(json.error ?? 'Gagal membuat booking.'); return }
      router.push(`/${locale}/bookings/${json.data.bookingId}`)
    } catch {
      setSubmitError('Terjadi kesalahan. Periksa koneksi internet.')
    } finally {
      setLoading(false)
    }
  }

  const selectedVehicle = vehicles.find(v => v.quotaId === quotaId)
  const estimatedTotal = selectedVehicle?.price ?? 0

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Bus className="h-4 w-4 text-primary" /> Pilih Trip & Tanggal</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Rute</Label>
            <ChoiceSelect ariaLabel="Rute" value={tripId} onChange={setTripId} clearable={false} options={trips.map(t => ({ id: t.id, label: t.name }))} />
          </div>
          <div className="space-y-2">
            <Label>Tanggal Perjalanan</Label>
            <input type="date" value={travelDate} onChange={e => setTravelDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>

        {travelDate && (
          <div className="space-y-2">
            <Label>Kendaraan</Label>
            {vehicles.length === 0 ? (
              <p className="text-xs text-muted-foreground">Tidak ada kendaraan tersedia untuk rute/tanggal ini.</p>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {vehicles.map(v => (
                  <button key={v.quotaId} type="button" onClick={() => setQuotaId(v.quotaId)}
                    disabled={v.availableSeats < 1}
                    className={cn('rounded-md border p-3 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                      quotaId === v.quotaId ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
                    <p className="text-sm font-medium">{v.vehicleName}</p>
                    <p className="text-xs text-muted-foreground">Kapasitas {v.capacity} · Sisa {v.availableSeats} kursi</p>
                    <p className="text-sm font-semibold text-primary mt-1">{formatRupiah(v.price)}</p>
                  </button>
                ))}
              </div>
            )}
            {errors.vehicle && <p className="text-xs text-destructive">{errors.vehicle}</p>}
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Detail Penjemputan (opsional)</Label>
            <input type="text" value={pickupDetail} onChange={e => setPickupDetail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="space-y-2">
            <Label>Detail Pengantaran (opsional)</Label>
            <input type="text" value={dropoffDetail} onChange={e => setDropoffDetail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
      </div>

      {pilgrims.map((pilgrim, idx) => (
        <div key={pilgrim.tempId} className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0">
                <UserRound className="h-4 w-4 text-primary" />
              </div>
              <h3 className="font-semibold text-sm">Penumpang {idx + 1}</h3>
            </div>
            {pilgrims.length > 1 && (
              <button type="button" onClick={() => removePilgrim(idx)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          {coreFields ? (
            <ManifestFieldsForm
              fields={coreFields}
              values={pilgrim.fieldValues}
              onChange={v => updateFieldValues(idx, v)}
              errors={pilgrimErrors(idx)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Memuat formulir data penumpang...</p>
          )}
        </div>
      ))}

      <Button variant="outline" onClick={addPilgrim} className="w-full">
        <Plus className="mr-2 h-4 w-4" /> Tambah Penumpang
      </Button>

      <div className="rounded-xl border bg-card p-6 space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Estimasi Total</p>
          <p className="text-xl font-bold text-primary">{formatRupiah(estimatedTotal)}</p>
        </div>
        {submitError && <p className="text-sm text-destructive">{submitError}</p>}
        <Button onClick={handleSubmit} disabled={loading} size="lg" className="w-full">
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Memproses...</> : <>Lanjut ke Pembayaran <ArrowRight className="ml-2 h-4 w-4" /></>}
        </Button>
      </div>
    </div>
  )
}
