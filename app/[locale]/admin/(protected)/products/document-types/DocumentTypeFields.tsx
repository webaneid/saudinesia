'use client'

import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DOCUMENT_ICON_NAMES, documentIcon } from '@/lib/documents/icons'
import type { DocumentTypeForm } from './documentTypeForm'

// Isian jenis dokumen (tambah & ubah). Label = teks PUBLIK — jangan pakai istilah internal (mis. BRN, K7).

const ICON_OPTIONS = DOCUMENT_ICON_NAMES.map(n => ({ id: n, label: n }))

type Props = { value: DocumentTypeForm; onChange: (v: DocumentTypeForm) => void; mode: 'create' | 'update'; isSystem?: boolean }

export function DocumentTypeFields({ value: f, onChange, mode, isSystem = false }: Props) {
  const set = <K extends keyof DocumentTypeForm>(k: K, v: DocumentTypeForm[K]) => onChange({ ...f, [k]: v })
  const Icon = documentIcon(f.icon)
  const locked = isSystem
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <p className="mb-1 text-xs text-admin-muted">Label (tampil ke jamaah)</p>
        <input className="admin-inp" value={f.label} onChange={e => set('label', e.target.value)} maxLength={80} placeholder="Surat Keterangan Mahram" autoFocus={mode === 'create'} />
      </div>
      <div>
        <p className="mb-1 text-xs text-admin-muted">Kunci {mode === 'update' && '(tetap)'}</p>
        <input className="admin-inp font-mono" value={f.key} onChange={e => set('key', e.target.value.toLowerCase())} disabled={mode === 'update'} maxLength={40} placeholder="surat_mahram" />
      </div>
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-xs text-admin-muted">Ikon <Icon className="h-3.5 w-3.5" aria-hidden /></p>
        <ChoiceSelect ariaLabel="Ikon" options={ICON_OPTIONS} value={f.icon} onChange={v => set('icon', v || 'FileText')} clearable={false} />
      </div>
      <div className="space-y-2 md:col-span-2">
        {locked && <p className="m-0 text-[11px] text-admin-muted">Jenis bawaan: sifat di bawah dipakai sistem dan tidak bisa diubah.</p>}
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.reusable} disabled={locked} onChange={e => set('reusable', e.target.checked)} /> Milik orang (dipakai ulang di pemesanan berikutnya). Tidak dicentang = per perjalanan.</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.allowMultiple} disabled={locked} onChange={e => set('allowMultiple', e.target.checked)} /> Boleh lebih dari satu berkas (tidak dicentang = unggahan baru menggantikan yang lama)</label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={f.hasExpiry} disabled={locked} onChange={e => onChange({ ...f, hasExpiry: e.target.checked, minValidityMonths: e.target.checked ? f.minValidityMonths : '' })} /> Punya masa berlaku</label>
      </div>
      {f.hasExpiry && (
        <div>
          <p className="mb-1 text-xs text-admin-muted">Minimal masih berlaku (bulan dari tanggal berangkat, opsional)</p>
          <input className="admin-inp" inputMode="numeric" value={f.minValidityMonths} onChange={e => set('minValidityMonths', e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="6" />
        </div>
      )}
      <div>
        <p className="mb-1 text-xs text-admin-muted">Urutan tampil</p>
        <input className="admin-inp" inputMode="numeric" value={f.order} onChange={e => set('order', e.target.value.replace(/\D/g, '').slice(0, 4))} />
      </div>
      <div>
        <p className="mb-1 text-xs text-admin-muted">Label kode referensi (opsional)</p>
        <input className="admin-inp" value={f.referenceLabel} onChange={e => set('referenceLabel', e.target.value)} maxLength={60} placeholder="Kode Booking (PNR)" />
      </div>
      {f.referenceLabel.trim() && (
        <div>
          <p className="mb-1 text-xs text-admin-muted">Format kode (opsional — diisi berarti wajib)</p>
          <input className="admin-inp font-mono" value={f.referencePattern} onChange={e => set('referencePattern', e.target.value)} maxLength={100} placeholder="^[A-Z0-9]{6}$" />
          <p className="mt-1 text-[11px] text-admin-muted">Hanya ^, $, [ ], huruf, angka, tanda hubung, dan {'{n,m}'}.</p>
        </div>
      )}
    </div>
  )
}
