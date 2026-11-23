'use client'

import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'

// Isian info produk visa — SATU bentuk untuk halaman Tambah (`new`) dan Edit (`[id]`), gaya sama dengan Haji/Paket (EditPage/CreatePage).

export type VisaInfo = { name: string; country: string; visaType: string; processDays: string; description: string }

export const EMPTY_VISA_INFO: VisaInfo = { name: '', country: 'Saudi Arabia', visaType: '', processDays: '14', description: '' }
export const VISA_TYPE_SUGGESTIONS = ['Umroh', 'Visitor', 'Bisnis', 'Kerja', 'Transit', 'Haji'] as const

export const visaInfoValid = (f: VisaInfo) => !!f.name.trim() && !!f.visaType.trim() && Number(f.processDays) > 0
export const visaInfoBody = (f: VisaInfo) => ({
  name: f.name.trim(), country: f.country.trim(), visaType: f.visaType.trim(), processDays: Number(f.processDays), description: f.description,
})

export function VisaInfoFields({ value: f, onChange, idPrefix, autoFocus }: { value: VisaInfo; onChange: (p: Partial<VisaInfo>) => void; idPrefix: string; autoFocus?: boolean }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="md:col-span-2">
        <p className="mb-1 text-xs text-admin-muted">Nama Produk</p>
        <input className="admin-inp" aria-label="Nama produk" autoFocus={autoFocus} value={f.name} onChange={e => onChange({ name: e.target.value })} placeholder="Visa Umroh Reguler 2026" />
      </div>
      <div>
        <p className="mb-1 text-xs text-admin-muted">Negara</p>
        <input className="admin-inp" aria-label="Negara" value={f.country} onChange={e => onChange({ country: e.target.value })} placeholder="Saudi Arabia" />
      </div>
      <div>
        <p className="mb-1 text-xs text-admin-muted">Jenis Visa (teks bebas)</p>
        <input className="admin-inp" aria-label="Jenis visa" value={f.visaType} onChange={e => onChange({ visaType: e.target.value })} placeholder="Umroh / Visitor / Bisnis…" list={`${idPrefix}-visa-types`} />
        <datalist id={`${idPrefix}-visa-types`}>{VISA_TYPE_SUGGESTIONS.map(t => <option key={t} value={t} />)}</datalist>
      </div>
      <div>
        <p className="mb-1 text-xs text-admin-muted">Estimasi Proses (hari kerja)</p>
        <input type="number" min={1} className="admin-inp" aria-label="Estimasi proses (hari kerja)" value={f.processDays} onChange={e => onChange({ processDays: e.target.value })} />
      </div>
      <div className="min-w-0 md:col-span-2">
        <p className="mb-1 text-xs text-admin-muted">Deskripsi</p>
        <RichTextEditor id={`${idPrefix}-description`} title="Deskripsi produk visa" value={f.description} onChange={description => onChange({ description })}
          placeholder="Jelaskan jenis visa ini, kelayakan pemohon, prosedur, dan catatan penting…" />
      </div>
    </div>
  )
}
