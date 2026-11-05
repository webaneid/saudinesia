'use client'

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, FileText, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { IconButton } from '@/components/admin/ui/IconButton'
import { Switch } from '@/components/admin/ui/Switch'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { documentIcon } from '@/lib/documents/icons'
import { moveRow, type RequirementRow } from './requirementRows'

// Editor syarat dokumen produk (docs/arsitektur-jamaah.md §7.6) — SATU komponen untuk semua produk yang punya syarat (Visa di Fase 5).
// Jenis dipilih dari katalog Produk → Jenis Dokumen; tidak ada kunci teks bebas. Disimpan oleh halaman pemilik (ganti-semua).

type CatalogType = { id: string; key: string; label: string; icon: string; reusable: boolean; isActive: boolean }
type Props = { rows: RequirementRow[]; onChange: (next: RequirementRow[]) => void; productNoun?: string }

export function RequirementsEditor({ rows, onChange, productNoun = 'produk ini' }: Props) {
  const [catalog, setCatalog] = useState<CatalogType[] | null>(null)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/v1/admin/products/document-types')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data?: CatalogType[] }) => { if (alive) setCatalog(j.data ?? []) })
      .catch(() => { if (alive) setLoadError(true) })
    return () => { alive = false }
  }, [])

  const byId = new Map((catalog ?? []).map(t => [t.id, t]))
  const taken = new Set(rows.map(r => r.documentTypeId))
  const addable = (catalog ?? []).filter(t => t.isActive && !taken.has(t.id))
  const update = (i: number, patch: Partial<RequirementRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const add = (t: CatalogType) => onChange([...rows, { documentTypeId: t.id, typeLabel: t.label, label: '', description: '', required: true }])

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><FileText className="size-4 text-admin-accent" /> Persyaratan dokumen</h2>
          <p className="m-0 mt-1 text-xs text-admin-muted">
            Dokumen yang diunggah per jamaah untuk {productNoun}. Jenis diambil dari katalog Produk → Jenis Dokumen; urutan di sini = urutan tampil ke jamaah.
          </p>
        </div>
        {loadError && <p className="m-0 text-xs text-admin-danger">Katalog jenis dokumen gagal dimuat. Muat ulang halaman.</p>}
        {addable.length > 0 && (
          <div className="space-y-1.5">
            <p className="label-kecil m-0">Tambah dokumen</p>
            <div className="flex flex-wrap gap-1.5">
              {addable.map(t => {
                const Icon = documentIcon(t.icon)
                return (
                  <button key={t.id} type="button" onClick={() => add(t)} className="admin-pill-off inline-flex items-center gap-1">
                    <Plus className="size-3" /> <Icon className="size-3" /> {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </Card>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-admin-line-strong px-6 py-10 text-center">
          <p className="m-0 text-sm font-semibold text-admin-ink">Belum ada persyaratan</p>
          <p className="m-0 mt-1 text-xs text-admin-muted">Tanpa syarat, jamaah tidak diminta mengunggah dokumen apa pun untuk {productNoun}.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => {
          const type = byId.get(row.documentTypeId)
          const Icon = documentIcon(type?.icon ?? 'FileText')
          const options = (catalog ?? [])
            .filter(t => t.id === row.documentTypeId || (t.isActive && !taken.has(t.id)))
            .map(t => ({ id: t.id, label: t.label }))
          if (!type) options.unshift({ id: row.documentTypeId, label: row.typeLabel })
          return (
            <Card key={row.documentTypeId} className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-admin-accent/12 text-admin-accent-strong"><Icon className="size-3.5" /></span>
                  <p className="m-0 truncate text-sm font-semibold text-admin-ink">{row.label.trim() || row.typeLabel}</p>
                  <Badge tone={row.required ? 'accent' : 'neutral'}>{row.required ? 'Wajib' : 'Opsional'}</Badge>
                  {type && !type.isActive && <Badge tone="warning">Jenis nonaktif</Badge>}
                  {type && !type.reusable && <Badge tone="neutral">Per perjalanan</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton label="Naikkan" disabled={i === 0} onClick={() => onChange(moveRow(rows, i, -1))}><ArrowUp className="size-4" /></IconButton>
                  <IconButton label="Turunkan" disabled={i === rows.length - 1} onClick={() => onChange(moveRow(rows, i, 1))}><ArrowDown className="size-4" /></IconButton>
                  <IconButton label="Hapus syarat" danger onClick={() => onChange(rows.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Jenis dokumen" htmlFor={`req-type-${i}`} required>
                  <ChoiceSelect
                    ariaLabel="Jenis dokumen" value={row.documentTypeId} clearable={false} options={options}
                    onChange={id => { const t = byId.get(id); if (t) update(i, { documentTypeId: t.id, typeLabel: t.label }) }}
                  />
                </FormField>
                <FormField label="Label untuk produk ini" htmlFor={`req-label-${i}`} hint="Opsional. Kosong = memakai nama jenis dokumen.">
                  <input id={`req-label-${i}`} className="admin-input" value={row.label} maxLength={80} placeholder={row.typeLabel} onChange={e => update(i, { label: e.target.value })} />
                </FormField>
                <div className="md:col-span-2">
                  <FormField label="Petunjuk untuk jamaah" htmlFor={`req-desc-${i}`} hint="Opsional. Tampil di bawah label.">
                    <input id={`req-desc-${i}`} className="admin-input" value={row.description} maxLength={300} placeholder="Scan halaman identitas, berwarna, tidak terpotong" onChange={e => update(i, { description: e.target.value })} />
                  </FormField>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch id={`req-required-${i}`} checked={row.required} onChange={required => update(i, { required })} label="Dokumen wajib" />
                <label htmlFor={`req-required-${i}`} className="cursor-pointer text-sm text-admin-ink">
                  <span className="font-semibold">{row.required ? 'Wajib' : 'Opsional'}</span>
                  <span className="ml-1.5 text-xs text-admin-muted">{row.required ? 'harus ada sebelum data jamaah lengkap' : 'tidak menghalangi kelengkapan'}</span>
                </label>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
