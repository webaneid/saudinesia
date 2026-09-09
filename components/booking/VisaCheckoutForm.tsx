'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Plus, Trash2, UserRound, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { formatRupiah, cn } from '@/lib/utils'
import { ManifestFieldsForm, type ManifestField, type PhoneValue } from '@/components/booking/ManifestFieldsForm'

type VisaProductOption = { id: string; name: string; country: string; visaType: string; price: number }

type CheckoutPilgrim = {
  tempId: string
  visaProductId: string
  fieldValues: Record<string, unknown>
}

function makePilgrim(preselectedProductId: string | null): CheckoutPilgrim {
  return { tempId: crypto.randomUUID(), visaProductId: preselectedProductId ?? '', fieldValues: {} }
}

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null || v === '') return true
  if (typeof v === 'object' && v !== null && 'number' in (v as object)) return !(v as PhoneValue).number
  return false
}

// docs/arsitektur-booking.md §6 Step 6b — checkout pendek Visa-only. State LOKAL (bukan context
// bersama) — halaman ini membangun items:[] + pilgrims[] langsung dan POST ke /api/v1/bookings
// yang SAMA. Wizard 7-langkah lama (lib/booking/draft.ts/DraftProvider) sudah dihapus total
// (docs/decisions.md 2026-07-25) — tidak ada lagi state bersama untuk direuse di sini.
export function VisaCheckoutForm({ products, preselectedProductId }: { products: VisaProductOption[]; preselectedProductId: string | null }) {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()

  const [departureDate, setDepartureDate] = useState('')
  const [returnDate,    setReturnDate]    = useState('')
  const [season,        setSeason]        = useState<'regular' | 'ramadan' | 'hajj'>('regular')
  const [pilgrims,      setPilgrims]      = useState<CheckoutPilgrim[]>([makePilgrim(preselectedProductId)])
  const [fieldsByProduct, setFieldsByProduct] = useState<Record<string, ManifestField[]>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState('')

  async function loadFieldsFor(productId: string) {
    if (!productId || fieldsByProduct[productId]) return
    const r = await fetch(`/api/v1/manifest/requirements?productType=visa&productId=${productId}`)
    const j = await r.json()
    setFieldsByProduct(prev => ({ ...prev, [productId]: j.data ?? [] }))
  }

  async function selectProduct(idx: number, productId: string) {
    setPilgrims(prev => prev.map((p, i) => i === idx ? { ...p, visaProductId: productId } : p))
    await loadFieldsFor(productId)
  }

  function updateFieldValues(idx: number, values: Record<string, unknown>) {
    setPilgrims(prev => prev.map((p, i) => i === idx ? { ...p, fieldValues: values } : p))
  }

  function addPilgrim() {
    setPilgrims(prev => [...prev, makePilgrim(preselectedProductId)])
  }
  function removePilgrim(idx: number) {
    setPilgrims(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)
  }

  function pilgrimErrors(idx: number): Record<string, string> {
    const prefix = `${idx}-`
    return Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]))
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!departureDate || !returnDate) errs.dates = 'Pilih tanggal berangkat dan kembali'
    pilgrims.forEach((p, i) => {
      if (!p.visaProductId) { errs[`${i}-visa`] = 'Pilih jenis visa'; return }
      const fields = fieldsByProduct[p.visaProductId] ?? []
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
          departureDate, returnDate, season,
          bookingType: pilgrims.length > 1 ? 'group' : 'individual',
          totalPilgrims: pilgrims.length,
          items: [],
          pilgrims: pilgrims.map(p => ({ fieldValues: p.fieldValues, visaProductId: p.visaProductId })),
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

  const estimatedTotal = pilgrims.reduce((sum, p) => {
    const product = products.find(prod => prod.id === p.visaProductId)
    return sum + (product?.price ?? 0)
  }, 0)

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Tanggal Perjalanan</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Tanggal Berangkat</Label>
            <input type="date" value={departureDate} onChange={e => setDepartureDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="space-y-2">
            <Label>Tanggal Kembali</Label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
        </div>
        {errors.dates && <p className="text-xs text-destructive">{errors.dates}</p>}
        <div className="space-y-2">
          <Label>Musim</Label>
          <div className="grid grid-cols-3 gap-2">
            {(['regular', 'ramadan', 'hajj'] as const).map(s => (
              <button key={s} type="button" onClick={() => setSeason(s)}
                className={cn('rounded-md border py-2 text-xs capitalize transition-colors',
                  season === s ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-accent')}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pilgrims.map((pilgrim, idx) => {
        const fields = pilgrim.visaProductId ? fieldsByProduct[pilgrim.visaProductId] : undefined
        return (
          <div key={pilgrim.tempId} className="rounded-xl border bg-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 shrink-0">
                  <UserRound className="h-4 w-4 text-primary" />
                </div>
                <h3 className="font-semibold text-sm">Jamaah {idx + 1}</h3>
              </div>
              {pilgrims.length > 1 && (
                <button type="button" onClick={() => removePilgrim(idx)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Jenis Visa <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {products.map(product => (
                  <button key={product.id} type="button" onClick={() => selectProduct(idx, product.id)}
                    className={cn('rounded-md border py-2 px-2 text-xs text-center transition-colors',
                      pilgrim.visaProductId === product.id ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-accent')}>
                    {product.name}
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{formatRupiah(product.price)}</span>
                  </button>
                ))}
              </div>
              {errors[`${idx}-visa`] && <p className="text-xs text-destructive">{errors[`${idx}-visa`]}</p>}
            </div>

            {pilgrim.visaProductId && (
              fields ? (
                <ManifestFieldsForm
                  fields={fields}
                  values={pilgrim.fieldValues}
                  onChange={v => updateFieldValues(idx, v)}
                  errors={pilgrimErrors(idx)}
                />
              ) : (
                <p className="text-xs text-muted-foreground">Memuat formulir data jamaah...</p>
              )
            )}
          </div>
        )
      })}

      <Button variant="outline" onClick={addPilgrim} className="w-full">
        <Plus className="mr-2 h-4 w-4" /> Tambah Jamaah
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
