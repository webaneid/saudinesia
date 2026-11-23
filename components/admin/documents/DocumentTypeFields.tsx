'use client'

import { useState, type ReactNode } from 'react'
import { FormField } from '@/components/admin/ui/FormField'
import { Switch } from '@/components/admin/ui/Switch'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DOCUMENT_ICON_NAMES, documentIcon } from '@/lib/documents/icons'
import { keyFromLabel, type DocumentTypeForm } from './documentTypeForm'

// Isian jenis dokumen — SATU formulir untuk halaman Produk → Jenis Dokumen (buat/ubah) dan tab "Berkas custom" di popup syarat produk
// (RequirementsTable). Label = teks PUBLIK — jangan pakai istilah internal (mis. BRN, K7).

const ICON_OPTIONS = DOCUMENT_ICON_NAMES.map(n => ({ id: n, label: n }))

type Props = {
  value: DocumentTypeForm
  onChange: (v: DocumentTypeForm) => void
  mode: 'create' | 'update'
  isSystem?: boolean
  /** Popup syarat menyembunyikan urutan katalog (urutan di produk diatur di tabel). */
  showOrder?: boolean
  /** Galat server per kolom (`meta.field`). */
  errors?: Partial<Record<keyof DocumentTypeForm, string>>
}

function Toggle({ id, checked, onChange, disabled, title, hint }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} label={title} className="mt-0.5" />
      <label htmlFor={id} className="cursor-pointer text-sm text-admin-ink">
        <span className="font-semibold">{title}</span>
        <span className="block text-xs text-admin-muted">{hint}</span>
      </label>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="label-kecil m-0">{title}</p>
      {children}
    </section>
  )
}

export function DocumentTypeFields({ value: f, onChange, mode, isSystem = false, showOrder = true, errors = {} }: Props) {
  const [keyTouched, setKeyTouched] = useState(mode === 'update' || f.key !== '')
  const set = <K extends keyof DocumentTypeForm>(k: K, v: DocumentTypeForm[K]) => onChange({ ...f, [k]: v })
  const Icon = documentIcon(f.icon)
  const locked = isSystem

  return (
    <div className="space-y-5">
      <Section title="Identitas berkas">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Label" htmlFor="dt-label" required error={errors.label} hint="Nama berkas yang dilihat jamaah.">
            <input id="dt-label" className="admin-input" value={f.label} maxLength={80} placeholder="Surat Keterangan Mahram" autoFocus={mode === 'create'}
              onChange={e => onChange({ ...f, label: e.target.value, ...(keyTouched ? {} : { key: keyFromLabel(e.target.value) }) })} />
          </FormField>
          <FormField label="Kode" htmlFor="dt-key" required={mode === 'create'} error={errors.key}
            hint={mode === 'update' ? 'Kunci data — tidak bisa diubah.' : 'Kunci data, tidak bisa diubah nanti. Huruf kecil, angka, garis bawah.'}>
            <input id="dt-key" className="admin-input font-mono" value={f.key} maxLength={40} placeholder="surat_mahram" disabled={mode === 'update'}
              onChange={e => { setKeyTouched(true); set('key', e.target.value.toLowerCase()) }} />
          </FormField>
          <FormField label="Ikon" htmlFor="dt-icon" labelAside={<Icon className="size-4 text-admin-accent" aria-hidden />}>
            <ChoiceSelect ariaLabel="Ikon" options={ICON_OPTIONS} value={f.icon} onChange={v => set('icon', v || 'FileText')} clearable={false} />
          </FormField>
          {showOrder && (
            <FormField label="Urutan di katalog" htmlFor="dt-order" hint="Angka kecil tampil lebih dulu di pilihan berkas.">
              <input id="dt-order" className="admin-input" inputMode="numeric" value={f.order} onChange={e => set('order', e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </FormField>
          )}
        </div>
      </Section>

      <Section title="Sifat berkas">
        {locked && <p className="m-0 text-xs text-admin-muted">Jenis bawaan: sifat ini dipakai sistem dan tidak bisa diubah.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Kepemilikan" htmlFor="dt-scope" error={errors.reusable}>
            <ChoiceSelect ariaLabel="Kepemilikan berkas" value={f.reusable ? 'person' : 'trip'} clearable={false} disabled={locked} onChange={v => set('reusable', v === 'person')}
              options={[{ id: 'person', label: 'Milik jamaah — dipakai ulang di booking lain' }, { id: 'trip', label: 'Per perjalanan — diunggah setiap booking' }]} />
          </FormField>
          <div className="space-y-3 md:pt-1">
            <Toggle id="dt-multiple" checked={f.allowMultiple} disabled={locked} onChange={v => set('allowMultiple', v)}
              title="Boleh lebih dari satu berkas" hint={f.allowMultiple ? 'Jamaah bisa mengunggah beberapa berkas jenis ini.' : 'Unggahan baru menggantikan yang lama.'} />
            <Toggle id="dt-expiry" checked={f.hasExpiry} disabled={locked} onChange={v => onChange({ ...f, hasExpiry: v, minValidityMonths: v ? f.minValidityMonths : '' })}
              title="Punya masa berlaku" hint="Jamaah mengisi tanggal terbit dan habis berlaku." />
          </div>
          {f.hasExpiry && (
            <FormField label="Minimal masih berlaku (bulan)" htmlFor="dt-validity" error={errors.minValidityMonths} hint="Dihitung dari tanggal berangkat. Opsional — paspor biasanya 6.">
              <input id="dt-validity" className="admin-input" inputMode="numeric" value={f.minValidityMonths} placeholder="6"
                onChange={e => set('minValidityMonths', e.target.value.replace(/\D/g, '').slice(0, 3))} />
            </FormField>
          )}
        </div>
      </Section>

      <Section title="Kode referensi (opsional)">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Label kode" htmlFor="dt-ref-label" error={errors.referenceLabel} hint="Mis. nomor booking tiket. Kosong = tidak meminta kode.">
            <input id="dt-ref-label" className="admin-input" value={f.referenceLabel} maxLength={60} placeholder="Kode Booking (PNR)" onChange={e => set('referenceLabel', e.target.value)} />
          </FormField>
          {f.referenceLabel.trim() && (
            <FormField label="Format kode" htmlFor="dt-ref-pattern" error={errors.referencePattern} hint={<>Diisi = kode wajib dan dicek. Hanya ^, $, [ ], huruf, angka, tanda hubung, dan {'{n,m}'}.</>}>
              <input id="dt-ref-pattern" className="admin-input font-mono" value={f.referencePattern} maxLength={100} placeholder="^[A-Z0-9]{6}$" onChange={e => set('referencePattern', e.target.value)} />
            </FormField>
          )}
        </div>
      </Section>
    </div>
  )
}
