'use client'

import { useState, type ReactNode } from 'react'
import { FormField } from '@/components/admin/ui/FormField'
import { Switch } from '@/components/admin/ui/Switch'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { FIELD_TYPE_LABEL, type ManifestFieldType } from '@/lib/manifest/fieldDefs'
import { CUSTOM_FIELD_TYPES } from '@/lib/validators/pilgrimFields'
import { keyFromFieldLabel, type PilgrimFieldForm } from './pilgrimFieldForm'

// Isian kolom Data Jamaah — SATU formulir untuk halaman Produk → Data Jamaah (buat/ubah), pola sama DocumentTypeFields.
// Label = teks yang dilihat jamaah di kartu dan formulir booking.

const TYPE_OPTIONS = CUSTOM_FIELD_TYPES.map(t => ({ id: t, label: FIELD_TYPE_LABEL[t] }))

type Props = {
  value: PilgrimFieldForm
  onChange: (v: PilgrimFieldForm) => void
  mode: 'create' | 'update'
  isSystem?: boolean
  /** Nama Lengkap: selalu wajib. */
  alwaysRequired?: boolean
  /** Kolom yang sudah berisi data: tipe tak bisa diubah. */
  typeLocked?: boolean
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="label-kecil m-0">{title}</p>
      {children}
    </section>
  )
}

export function PilgrimFieldFields({ value: f, onChange, mode, isSystem = false, alwaysRequired = false, typeLocked = false }: Props) {
  const [keyTouched, setKeyTouched] = useState(mode === 'update' || f.key !== '')
  const set = <K extends keyof PilgrimFieldForm>(k: K, v: PilgrimFieldForm[K]) => onChange({ ...f, [k]: v })
  const typeOptions = isSystem && !TYPE_OPTIONS.some(o => o.id === f.fieldType)
    ? [...TYPE_OPTIONS, { id: f.fieldType, label: FIELD_TYPE_LABEL[f.fieldType as ManifestFieldType] ?? f.fieldType }]
    : TYPE_OPTIONS

  return (
    <div className="space-y-5">
      <Section title="Identitas kolom">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Label" htmlFor="pf-label" required hint="Nama kolom yang dilihat jamaah.">
            <input id="pf-label" className="admin-input" value={f.label} maxLength={80} placeholder="Golongan Darah" autoFocus={mode === 'create'}
              onChange={e => onChange({ ...f, label: e.target.value, ...(keyTouched ? {} : { key: keyFromFieldLabel(e.target.value) }) })} />
          </FormField>
          <FormField label="Kode" htmlFor="pf-key" required={mode === 'create'}
            hint={mode === 'update' ? 'Kunci data — tidak bisa diubah.' : 'Kunci data, tidak bisa diubah nanti. Huruf dan angka tanpa spasi, diawali huruf kecil.'}>
            <input id="pf-key" className="admin-input font-mono" value={f.key} maxLength={40} placeholder="golonganDarah" disabled={mode === 'update'}
              onChange={e => { setKeyTouched(true); set('key', e.target.value.replace(/[^A-Za-z0-9]/g, '')) }} />
          </FormField>
          <FormField label="Urutan" htmlFor="pf-order" hint="Angka kecil tampil lebih dulu di formulir jamaah.">
            <input id="pf-order" className="admin-input" inputMode="numeric" value={f.order} onChange={e => set('order', e.target.value.replace(/\D/g, '').slice(0, 4))} />
          </FormField>
        </div>
      </Section>

      <Section title="Isian">
        {isSystem && <p className="m-0 text-xs text-admin-muted">Kolom bawaan: tipe dan pilihannya dipakai sistem (kartu jamaah, enkripsi NIK/paspor) dan tidak bisa diubah.</p>}
        {!isSystem && typeLocked && <p className="m-0 text-xs text-admin-muted">Kolom ini sudah berisi data jamaah — tipenya tidak bisa diubah lagi.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Tipe isian" htmlFor="pf-type">
            <ChoiceSelect ariaLabel="Tipe isian" options={typeOptions} value={f.fieldType} clearable={false} disabled={isSystem || typeLocked}
              onChange={v => set('fieldType', v || 'text')} />
          </FormField>
          <div className="flex items-start gap-3 md:pt-6">
            <Switch id="pf-required" checked={f.required || alwaysRequired} onChange={v => set('required', v)} disabled={alwaysRequired} label="Wajib diisi" className="mt-0.5" />
            <label htmlFor="pf-required" className="cursor-pointer text-sm text-admin-ink">
              <span className="font-semibold">Wajib diisi</span>
              <span className="block text-xs text-admin-muted">{alwaysRequired ? 'Nama Lengkap selalu wajib.' : 'Data jamaah belum lengkap sampai kolom ini terisi.'}</span>
            </label>
          </div>
          {f.fieldType === 'select' && (
            <div className="md:col-span-2">
              <FormField label="Daftar pilihan" htmlFor="pf-options" hint={isSystem ? 'Pilihan bawaan.' : 'Satu pilihan per baris, minimal 2.'}>
                <textarea id="pf-options" className="admin-input" rows={4} value={f.optionsText} disabled={isSystem} onChange={e => set('optionsText', e.target.value)} />
              </FormField>
            </div>
          )}
        </div>
      </Section>
    </div>
  )
}
