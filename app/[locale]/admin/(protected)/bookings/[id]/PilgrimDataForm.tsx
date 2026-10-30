'use client'

import { useState } from 'react'
import { Save } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { ManifestFieldsForm, type ManifestField } from '@/components/booking/ManifestFieldsForm'
import { completeness } from '@/lib/manifest/values'

// Data jamaah diisi admin SETELAH terbit (docs/arsitektur-booking-engine-v2.md §10.3, D3): field mengikuti produk visa jamaah (atau `core`), boleh disimpan
// sebagian lalu dilanjutkan; lencana kelengkapan dihitung dari fungsi yang SAMA dengan server (lib/manifest/values.ts). Galat server ditampilkan per field.
type Props = {
  bookingId: string
  pilgrimId: string
  fields: ManifestField[]
  initial: Record<string, unknown>
  /** null = jamaah tanpa visa (tak ada rencana tanggal visa). */
  plannedTravelDate: string | null | undefined
}

export function PilgrimDataForm({ bookingId, pilgrimId, fields, initial, plannedTravelDate }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [planned, setPlanned] = useState(plannedTravelDate ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const status = completeness(fields, values)

  async function save() {
    setBusy(true); setNotice(null); setErrors({})
    try {
      const body = { fieldValues: Object.fromEntries(fields.map(f => [f.fieldKey, values[f.fieldKey] ?? null])), ...(plannedTravelDate !== undefined && { plannedTravelDate: planned || null }) }
      const res = await fetch(`/api/v1/admin/bookings/${bookingId}/pilgrims/${pilgrimId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setErrors(json?.meta?.errors ?? {})
        setNotice({ text: json?.error ?? 'Data jamaah gagal disimpan.', error: true })
        return
      }
      setNotice({ text: 'Data jamaah tersimpan.', error: false })
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3 rounded-lg border border-admin-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[12px] font-semibold text-admin-ink">Data jamaah</p>
        <Badge tone={status.complete ? 'ok' : 'warning'}>{status.filled}/{status.required} wajib terisi</Badge>
      </div>
      {fields.length === 0
        ? <p className="m-0 text-[12px] text-admin-muted">Produk ini belum punya daftar field data jamaah.</p>
        : <ManifestFieldsForm fields={fields} values={values} onChange={v => { setValues(v); setNotice(null) }} errors={errors} />}
      {plannedTravelDate !== undefined && (
        <label className="block max-w-xs space-y-1">
          <span className="text-[12px] font-medium text-admin-ink">Rencana tanggal berangkat (visa)</span>
          <input type="date" className="admin-inp" value={planned} onChange={e => { setPlanned(e.target.value); setNotice(null) }} />
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={save} loading={busy}><Save className="size-4" /> Simpan data jamaah</Button>
        {!status.complete && <p className="m-0 text-[11px] text-admin-muted">Belum diisi: {status.missing.join(', ')}</p>}
        {notice && <p role={notice.error ? 'alert' : 'status'} className={`m-0 text-[12px] font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ok'}`}>{notice.text}</p>}
      </div>
    </div>
  )
}
