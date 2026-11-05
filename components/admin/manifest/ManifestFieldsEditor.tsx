'use client'

import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { FormField } from '@/components/admin/ui/FormField'
import { IconButton } from '@/components/admin/ui/IconButton'
import { Switch } from '@/components/admin/ui/Switch'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { moveRow } from '@/components/admin/documents/requirementRows'
import { FIELD_TYPE_LABEL, MANIFEST_FIELD_TYPES, type ManifestFieldType } from '@/lib/manifest/fieldDefs'
import { isSealedRole } from '@/lib/manifest/roles'
import { addableStandard, defaultRows, newFreeRow, rowFromStandard, type ManifestRow } from './manifestRows'

// Editor kolom data jamaah produk (docs/arsitektur-manifest.md §9). Kolom standar terhubung ke kartu jamaah dan tipenya tetap; kolom bebas = data khusus produk.
// Disimpan oleh halaman pemilik (ganti-semua).

const TYPE_OPTIONS = MANIFEST_FIELD_TYPES.map(t => ({ id: t, label: FIELD_TYPE_LABEL[t] }))

type Props = {
  rows: ManifestRow[]
  onChange: (next: ManifestRow[]) => void
  /** Produk sudah pernah dipesan: tipe kolom yang sudah tersimpan dikunci. */
  used: boolean
  productNoun?: string
}

export function ManifestFieldsEditor({ rows, onChange, used, productNoun = 'produk ini' }: Props) {
  const update = (i: number, patch: Partial<ManifestRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const addable = addableStandard(rows)

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div>
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-admin-ink"><ListChecks className="size-4 text-admin-accent" /> Data jamaah</h2>
          <p className="m-0 mt-1 text-xs text-admin-muted">
            Kolom isian per jamaah untuk {productNoun}. Untuk berkas yang diunggah, pakai tab Persyaratan dokumen.
            {used && ' Produk ini sudah pernah dipesan, jadi tipe kolom yang sudah ada tidak bisa diubah.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="label-kecil m-0">Tambah kolom</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onChange([...rows, newFreeRow()])} className="admin-pill-off inline-flex items-center gap-1 font-semibold">
              <Plus className="size-3" /> Kolom baru
            </button>
            {rows.length > 0 && addable.map(s => (
              <button key={s.role} type="button" onClick={() => onChange([...rows, rowFromStandard(s)])} className="admin-pill-off inline-flex items-center gap-1">
                <Plus className="size-3" /> {s.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-admin-line-strong px-6 py-10 text-center">
          <p className="m-0 text-sm font-semibold text-admin-ink">Belum ada kolom data jamaah</p>
          <p className="m-0 mb-3 mt-1 text-xs text-admin-muted">Tanpa kolom, form jamaah untuk {productNoun} kosong, termasuk nama.</p>
          <Button size="sm" onClick={() => onChange(defaultRows())}><Plus className="size-4" /> Pakai kolom standar</Button>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((row, i) => {
          const isName = row.role === 'display_name'
          const typeLocked = used && row.fieldKey !== null
          return (
            <Card key={row.uid} className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="m-0 truncate text-sm font-semibold text-admin-ink">{row.label.trim() || 'Kolom baru'}</p>
                  <Badge tone={row.required ? 'accent' : 'neutral'}>{row.required ? 'Wajib' : 'Opsional'}</Badge>
                  {row.role && <Badge tone="neutral">Terhubung kartu jamaah</Badge>}
                  {isSealedRole(row.role) && <Badge tone="neutral">Terenkripsi</Badge>}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton label="Naikkan" disabled={i === 0} onClick={() => onChange(moveRow(rows, i, -1))}><ArrowUp className="size-4" /></IconButton>
                  <IconButton label="Turunkan" disabled={i === rows.length - 1} onClick={() => onChange(moveRow(rows, i, 1))}><ArrowDown className="size-4" /></IconButton>
                  <IconButton label="Hapus kolom" danger disabled={isName} onClick={() => onChange(rows.filter((_, idx) => idx !== i))}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Nama kolom" htmlFor={`mf-label-${row.uid}`} required>
                  <input id={`mf-label-${row.uid}`} className="admin-input" value={row.label} maxLength={80} placeholder="Nomor HP Host" onChange={e => update(i, { label: e.target.value })} />
                </FormField>
                <FormField label="Tipe isian" htmlFor={`mf-type-${row.uid}`} hint={row.role ? 'Tipe kolom standar tetap.' : undefined}>
                  <ChoiceSelect
                    ariaLabel="Tipe isian" value={row.fieldType} clearable={false} options={TYPE_OPTIONS} disabled={!!row.role || typeLocked}
                    onChange={t => update(i, { fieldType: t as ManifestFieldType })}
                  />
                </FormField>
                {!row.role && row.fieldType === 'select' && (
                  <div className="md:col-span-2">
                    <FormField label="Daftar pilihan" htmlFor={`mf-options-${row.uid}`} hint="Satu pilihan per baris, minimal 2.">
                      <textarea id={`mf-options-${row.uid}`} className="admin-inp" rows={3} value={row.optionsText} onChange={e => update(i, { optionsText: e.target.value })} />
                    </FormField>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Switch id={`mf-required-${row.uid}`} checked={row.required} disabled={isName} onChange={required => update(i, { required })} label="Kolom wajib" />
                <label htmlFor={`mf-required-${row.uid}`} className="cursor-pointer text-sm text-admin-ink">
                  <span className="font-semibold">{row.required ? 'Wajib' : 'Opsional'}</span>
                  <span className="ml-1.5 text-xs text-admin-muted">{isName ? 'nama jamaah selalu wajib' : row.required ? 'harus diisi sebelum data jamaah lengkap' : 'boleh dikosongkan'}</span>
                </label>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
