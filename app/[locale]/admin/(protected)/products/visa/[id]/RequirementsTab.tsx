'use client'

import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { Switch } from '@/components/admin/ui/Switch'
import type { VisaRequirement } from '@/lib/types/visa'

// Pilihan cepat: kunci mesin + label default. docType tetap teks bebas (datalist hanya saran).
const PRESETS: readonly { docType: string; label: string }[] = [
  { docType: 'passport', label: 'Paspor' },
  { docType: 'ktp', label: 'KTP' },
  { docType: 'kk', label: 'Kartu Keluarga' },
  { docType: 'photo', label: 'Pas foto' },
  { docType: 'evaksin', label: 'Sertifikat vaksin' },
  { docType: 'etiket', label: 'E-tiket pesawat' },
  { docType: 'rekening', label: 'Rekening koran' },
  { docType: 'sponsor', label: 'Surat sponsor' },
  { docType: 'iqomah', label: 'Iqomah / penjamin Saudi' },
  { docType: 'surat_nikah', label: 'Surat nikah' },
  { docType: 'akta_lahir', label: 'Akta lahir' },
  { docType: 'ijazah', label: 'Ijazah' },
]

type Props = { reqs: VisaRequirement[]; onChange: (next: VisaRequirement[]) => void }

export function RequirementsTab({ reqs, onChange }: Props) {
  const add = (r?: Partial<VisaRequirement>) => onChange([...reqs, { docType: '', label: '', description: '', required: true, ...r }])
  const remove = (i: number) => onChange(reqs.filter((_, idx) => idx !== i))
  const update = (i: number, patch: Partial<VisaRequirement>) => onChange(reqs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    const a = reqs[i]
    const b = reqs[j]
    if (!a || !b) return
    const next = [...reqs]
    next[i] = b
    next[j] = a
    onChange(next)
  }

  const taken = new Set(reqs.map(r => r.docType))
  const presets = PRESETS.filter(p => !taken.has(p.docType))

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><FileText className="size-4 text-admin-accent" /> Persyaratan dokumen</h2>
            <p className="m-0 mt-1 text-xs text-admin-muted">Dokumen yang wajib atau opsional diunggah jamaah untuk visa ini. Urutan di sini = urutan tampil ke jamaah.</p>
          </div>
          <Button size="sm" onClick={() => add()}><Plus className="size-4" /> Tambah dokumen</Button>
        </div>
        {presets.length > 0 && (
          <div className="space-y-1.5">
            <p className="label-kecil m-0">Tambah cepat</p>
            <div className="flex flex-wrap gap-1.5">
              {presets.map(p => (
                <button key={p.docType} type="button" onClick={() => add({ docType: p.docType, label: p.label })} className="admin-pill-off inline-flex items-center gap-1">
                  <Plus className="size-3" /> {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      {reqs.length === 0 && (
        <div className="rounded-2xl border border-dashed border-admin-line-strong px-6 py-10 text-center">
          <p className="m-0 text-sm font-semibold text-admin-ink">Belum ada persyaratan</p>
          <p className="m-0 mt-1 text-xs text-admin-muted">Pilih dokumen di atas atau klik Tambah dokumen. Jamaah baru bisa lanjut bila semua dokumen wajib sudah diunggah.</p>
        </div>
      )}

      <div className="space-y-3">
        {reqs.map((req, i) => (
          <Card key={i} className="space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="grid size-7 place-items-center rounded-full bg-admin-accent/12 text-xs font-bold text-admin-accent-strong">{i + 1}</span>
                <p className="m-0 text-sm font-semibold text-admin-ink">{req.label || 'Dokumen baru'}</p>
                <Badge tone={req.required ? 'accent' : 'neutral'}>{req.required ? 'Wajib' : 'Opsional'}</Badge>
              </div>
              <div className="flex items-center gap-1">
                <IconButton label="Naikkan" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconButton>
                <IconButton label="Turunkan" disabled={i === reqs.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconButton>
                <IconButton label="Hapus dokumen" danger onClick={() => remove(i)}><Trash2 className="size-4" /></IconButton>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Label (tampil ke jamaah)" htmlFor={`req-label-${i}`} required>
                <input id={`req-label-${i}`} className="admin-input" value={req.label} placeholder="Paspor asli (scan semua halaman)" onChange={e => update(i, { label: e.target.value })} />
              </FormField>
              <FormField label="Kunci mesin (docType)" htmlFor={`req-type-${i}`} required hint="Dipakai sistem untuk mengenali dokumen. Huruf kecil tanpa spasi.">
                <input
                  id={`req-type-${i}`} className="admin-input font-mono text-[13px]" value={req.docType} placeholder="passport"
                  list="doc-type-suggestions" onChange={e => update(i, { docType: e.target.value })}
                />
              </FormField>
              <div className="md:col-span-2">
                <FormField label="Instruksi detail" htmlFor={`req-desc-${i}`} hint="Opsional. Tampil di bawah label.">
                  <input id={`req-desc-${i}`} className="admin-input" value={req.description} placeholder="Berlaku minimal 7 bulan dari tanggal keberangkatan" onChange={e => update(i, { description: e.target.value })} />
                </FormField>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Switch id={`req-required-${i}`} checked={req.required} onChange={required => update(i, { required })} label="Dokumen wajib" />
              <label htmlFor={`req-required-${i}`} className="cursor-pointer text-sm text-admin-ink">
                <span className="font-semibold">{req.required ? 'Wajib' : 'Opsional'}</span>
                <span className="ml-1.5 text-xs text-admin-muted">{req.required ? 'harus diunggah sebelum jamaah bisa lanjut' : 'tidak memblokir proses'}</span>
              </label>
            </div>
          </Card>
        ))}
      </div>

      <datalist id="doc-type-suggestions">
        {PRESETS.map(p => <option key={p.docType} value={p.docType} />)}
      </datalist>
    </div>
  )
}

function IconButton({ label, danger, disabled, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg transition-colors disabled:opacity-30 ${danger ? 'text-admin-muted hover:bg-admin-danger/10 hover:text-admin-danger' : 'text-admin-muted hover:bg-admin-spot hover:text-admin-ink'}`}
    >
      {children}
    </button>
  )
}
