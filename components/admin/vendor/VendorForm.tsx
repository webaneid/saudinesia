'use client'

import { useMemo, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { AutocompleteSelect } from '@/components/shared/AutocompleteSelect'
import { COUNTRY_OPTIONS } from '@/lib/ui/countryOptions'
import { AddressPicker } from '@/components/shared/AddressPicker'
import { ContactPicker } from '@/components/shared/ContactPicker'
import { Button } from '@/components/admin/ui/Button'
import { FormField } from '@/components/admin/ui/FormField'
import { cn } from '@/lib/utils'
import {
  EMPTY_VENDOR_FORM, formStateToBody, vendorToFormState,
  type VendorCategoryOption, type VendorFormState, type VendorRecord,
} from './types'


type Props = {
  /** Ada = ubah vendor itu (PUT); tidak ada = buat baru (POST). */
  vendor?: VendorRecord
  /** Semua kategori (aktif maupun nonaktif); yang nonaktif hanya tampil bila vendor sudah memakainya. */
  categories: VendorCategoryOption[]
  /** Pra-isi untuk pembuatan cepat dari modal (F4): nama yang diketik, kategori konteks. */
  initialName?: string
  initialCategoryIds?: string[]
  /** Fokus langsung ke kolom nama (dipakai saat formulir dibuka di modal). */
  autoFocusName?: boolean
  onSaved: (vendor: VendorRecord) => void
  onCancel?: () => void
  submitLabel?: string
}

/**
 * SATU-SATUNYA formulir vendor (ADR-0003 keputusan 5): dipakai halaman Sistem → Vendor dan modal "Vendor baru" di setiap editor biaya.
 * Formulir menyimpan sendiri lewat API vendor, lalu memanggil `onSaved` dengan vendor tersimpan.
 */
export function VendorForm({ vendor, categories, initialName, initialCategoryIds, autoFocusName, onSaved, onCancel, submitLabel }: Props) {
  const [form, setForm] = useState<VendorFormState>(() => {
    if (vendor) return vendorToFormState(vendor)
    return { ...EMPTY_VENDOR_FORM, name: initialName ?? '', categoryIds: initialCategoryIds ?? [] }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Kategori nonaktif tidak boleh dipilih baru, tetapi yang sudah menempel di vendor tetap tampil agar tidak hilang diam-diam saat disimpan.
  const selectable = useMemo(
    () => categories.filter(c => c.isActive || form.categoryIds.includes(c.id)),
    [categories, form.categoryIds],
  )
  const needsCompletion = !!vendor && vendor.categories.length === 0

  const set = <K extends keyof VendorFormState>(key: K, value: VendorFormState[K]) => setForm(prev => ({ ...prev, [key]: value }))
  const toggleCategory = (id: string) =>
    set('categoryIds', form.categoryIds.includes(id) ? form.categoryIds.filter(c => c !== id) : [...form.categoryIds, id])

  async function submit() {
    setError(null)
    if (!form.name.trim()) return setError('Nama vendor wajib diisi')
    if (!form.countryCode) return setError('Pilih negara vendor')
    if (form.categoryIds.length === 0) return setError('Pilih minimal satu kategori')

    setSaving(true)
    try {
      const res = await fetch(vendor ? `/api/v1/admin/system/vendors/${vendor.id}` : '/api/v1/admin/system/vendors', {
        method: vendor ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formStateToBody(form)),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(json?.error ?? 'Vendor gagal disimpan')
        return
      }
      onSaved(json.data as VendorRecord)
    } catch {
      setError('Tidak dapat menghubungi server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      {needsCompletion && (
        <p className="m-0 rounded-xl bg-admin-warning/14 px-3 py-2 text-sm text-admin-ink">
          Vendor ini belum punya kategori — pilih kategori yang benar lalu simpan.
        </p>
      )}

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <FormField label="Nama vendor" htmlFor="vendor-name" required>
          <input id="vendor-name" autoFocus={autoFocusName} className="admin-inp" value={form.name} maxLength={160} onChange={e => set('name', e.target.value)} />
        </FormField>
        <FormField label="Negara" htmlFor="vendor-country" required hint="Nama yang sama di negara berbeda dianggap vendor berbeda.">
          <AutocompleteSelect options={COUNTRY_OPTIONS} value={form.countryCode} onChange={v => set('countryCode', v)} placeholder="Cari negara…" />
        </FormField>
      </div>

      <FormField label="Kategori" htmlFor="vendor-categories" required hint="Satu vendor boleh punya beberapa kategori (mis. hotel sekaligus katering).">
        <div id="vendor-categories" role="group" aria-label="Kategori vendor" className="flex flex-wrap gap-2">
          {selectable.map(c => {
            const on = form.categoryIds.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleCategory(c.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors',
                  on ? 'border-admin-accent bg-admin-accent text-white' : 'border-admin-line bg-white text-admin-muted hover:bg-admin-spot',
                )}
              >
                {on && <Check className="size-3.5" />}
                {c.name}
                {!c.isActive && <span className="opacity-70">(nonaktif)</span>}
              </button>
            )
          })}
        </div>
      </FormField>

      <section className="grid gap-4 rounded-2xl border border-admin-line p-4">
        <h3 className="m-0 text-sm font-bold text-admin-ink">Kontak</h3>
        <FormField label="Nama PIC" htmlFor="vendor-pic">
          <input id="vendor-pic" className="admin-inp" value={form.contactName} maxLength={120} onChange={e => set('contactName', e.target.value)} />
        </FormField>
        <ContactPicker value={form.contact} onChange={v => set('contact', v)} />
        <FormField label="Website" htmlFor="vendor-website" hint="Awali dengan https://">
          <input id="vendor-website" className="admin-inp" inputMode="url" value={form.website} onChange={e => set('website', e.target.value)} />
        </FormField>
      </section>

      <section className="grid gap-3 rounded-2xl border border-admin-line p-4">
        <h3 className="m-0 text-sm font-bold text-admin-ink">Alamat</h3>
        <AddressPicker value={form.address} onChange={v => set('address', v)} />
      </section>

      <FormField label="Catatan" htmlFor="vendor-notes">
        <textarea id="vendor-notes" className="admin-inp min-h-24" value={form.notes} maxLength={2000} onChange={e => set('notes', e.target.value)} />
      </FormField>

      {error && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <Button variant="ghost" onClick={onCancel} disabled={saving}>Batal</Button>}
        <Button onClick={submit} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          {submitLabel ?? (vendor ? 'Simpan perubahan' : 'Simpan vendor')}
        </Button>
      </div>
    </div>
  )
}
