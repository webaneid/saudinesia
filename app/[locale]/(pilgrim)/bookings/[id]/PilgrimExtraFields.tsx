'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ManifestFieldsForm, type ManifestField } from '@/components/booking/ManifestFieldsForm'

// Kolom tambahan jamaah booking yang TIDAK berasal dari kartu Jamaah Saya (mis. "Nomor HP Host" visa tertentu) — diisi pemesan sendiri
// (audit front-end 2026-11-11). Disimpan lewat PUT /api/v1/bookings/[id]/pilgrims/[pilgrimId]; server menolak kolom kartu dan data terkunci.

type Props = {
  bookingId: string
  pilgrimId: string
  fields: ManifestField[]
  initial: Record<string, unknown>
  /** false = tampil baca saja (booking tidak aktif atau data sedang/sudah diperiksa). */
  editable: boolean
}

export function PilgrimExtraFields({ bookingId, pilgrimId, fields, initial, editable }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  async function save() {
    setBusy(true); setNotice(null); setErrors({})
    try {
      const res = await fetch(`/api/v1/bookings/${bookingId}/pilgrims/${pilgrimId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fieldValues: values }),
      })
      const json = (await res.json().catch(() => null)) as { error?: string; meta?: { field?: string } } | null
      if (!res.ok) {
        const text = json?.error ?? 'Gagal menyimpan.'
        if (json?.meta?.field) setErrors({ [json.meta.field]: text })
        setNotice({ text, error: true })
        return
      }
      setNotice({ text: 'Data tambahan tersimpan.', error: false })
      router.refresh()
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-labelledby="data-tambahan">
      <div>
        <h2 id="data-tambahan" className="font-semibold">Data tambahan</h2>
        <p className="text-sm text-muted-foreground">Diminta oleh produk yang Anda pesan untuk jamaah ini.</p>
      </div>
      <fieldset disabled={!editable || busy} className="space-y-4">
        <ManifestFieldsForm fields={fields} values={values} onChange={setValues} errors={errors} />
      </fieldset>
      {notice && <p className={notice.error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'} role="status">{notice.text}</p>}
      {editable && (
        <Button size="sm" onClick={save} disabled={busy}><Save className="h-4 w-4" /> Simpan data tambahan</Button>
      )}
    </section>
  )
}
