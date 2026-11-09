'use client'

import { useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { bodyFromForm, canSubmitPilgrim, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import type { PilgrimWarning } from '@/lib/pilgrims/service'

// Buat kartu "Jamaah Saya" tanpa meninggalkan booking: formulir kartu yang sama (SavedPilgrimFields), disimpan lewat API kartu
// (POST /api/v1/account/pilgrims → lib/pilgrims/service.ts), lalu pemanggil menautkannya ke jamaah booking. Galat server tampil; formulir tetap terbuka.

type Props = {
  idPrefix: string
  title: string
  initial: SavedPilgrimFormValue
  showSelf: boolean
  onCancel: () => void
  /** Dipanggil sesudah kartu tersimpan; mengembalikan pesan galat bila langkah berikutnya (tautkan) gagal. */
  onSaved: (cardId: string, warnings: PilgrimWarning[]) => Promise<string | null>
}

export function InlinePilgrimForm({ idPrefix, title, initial, showSelf, onCancel, onSaved }: Props) {
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!canSubmitPilgrim(form) || busy) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/v1/account/pilgrims', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFromForm(form)) })
      const json = await res.json().catch(() => null) as { data?: { id?: string }; error?: string; meta?: { warnings?: PilgrimWarning[] } } | null
      if (!res.ok || !json?.data?.id) { setError(json?.error ?? 'Data jamaah gagal disimpan.'); return }
      const failed = await onSaved(json.data.id, json.meta?.warnings ?? [])
      if (failed) setError(`Data tersimpan di Jamaah Saya, tetapi belum terpasang ke booking: ${failed}`)
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border bg-background p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{title}</p>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy} aria-label="Tutup formulir"><X className="h-4 w-4" /></Button>
      </div>
      <SavedPilgrimFields value={form} onChange={setForm} showSelf={showSelf} idPrefix={idPrefix} />
      <p className="text-xs text-muted-foreground">Data ini juga tersimpan di Jamaah Saya, jadi bisa dipakai lagi untuk pesanan berikutnya. Paspor dan KTP diunggah sesudah disimpan.</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={save} disabled={busy || !canSubmitPilgrim(form)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Simpan & pakai
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Batal</Button>
      </div>
    </div>
  )
}
