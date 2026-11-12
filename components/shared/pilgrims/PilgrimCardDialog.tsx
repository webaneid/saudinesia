'use client'

import { useEffect, useState } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/shared/Modal'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { bodyFromForm, canSubmitPilgrim, formFromCard, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import type { PilgrimWarning, SavedPilgrimView } from '@/lib/pilgrims/service'
import { useApiError } from '@/components/shared/useApiError'

// Popup kartu jamaah tanpa meninggalkan booking — SATU komponen untuk halaman jamaah dan admin, untuk MEMBUAT dan MENGUBAH kartu:
// formulir kartu yang sama (SavedPilgrimFields), disimpan lewat API kartu (`endpoint`: /api/v1/account/pilgrims atau
// /api/v1/admin/customers/{id}/pilgrims → lib/pilgrims/service.ts), lalu pemanggil menautkan/menyalin ulang kartu ke jamaah booking.
// Galat server tampil; popup tetap terbuka. NIK/paspor tersimpan tak pernah dikirim ke klien (kosong = tetap).

type Props = {
  /** Koleksi kartu (POST membuat; `${endpoint}/${cardId}` GET/PUT mengubah). */
  endpoint: string
  /** Ada = ubah kartu ini; tidak ada = buat kartu baru dari `initial`. */
  cardId?: string
  /** Kalimat pembuka di atas formulir. */
  intro: string
  idPrefix: string
  title: string
  initial?: SavedPilgrimFormValue
  showSelf: boolean
  /** Label tombol simpan (bawaan: "Simpan & pakai"). */
  saveLabel?: string
  onClose: () => void
  /** Dipanggil sesudah kartu tersimpan; mengembalikan pesan galat bila langkah berikutnya (tautkan/salin ke booking) gagal. */
  onSaved: (cardId: string, warnings: PilgrimWarning[]) => Promise<string | null>
}

type Json = { data?: Record<string, unknown> & { id?: string }; error?: string; meta?: { warnings?: PilgrimWarning[] } } | null

export function PilgrimCardDialog({ endpoint, cardId, intro, idPrefix, title, initial, showSelf, saveLabel, onClose, onSaved }: Props) {
  const t = useTranslations('shared.pilgrims.dialog')
  const errorText = useApiError()
  const [form, setForm] = useState<SavedPilgrimFormValue | null>(cardId ? null : initial ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kartu sudah tersimpan tapi langkah berikutnya gagal: jangan simpan ulang (membuat kartu ganda) — hanya ulangi langkah itu.
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    if (!cardId) return
    let alive = true
    fetch(`${endpoint}/${cardId}`, { cache: 'no-store' })
      .then(r => r.json() as Promise<Json>)
      .then(j => { if (!alive) return; if (j?.data) setForm(formFromCard(j.data as unknown as SavedPilgrimView)); else setError(errorText(j, t('loadFailed'))) })
      .catch(() => alive && setError(t('network')))
    return () => { alive = false }
  }, [endpoint, cardId, t, errorText])

  async function save() {
    if (!form || !canSubmitPilgrim(form) || busy) return
    setBusy(true); setError(null)
    try {
      let id = savedId
      let warnings: PilgrimWarning[] = []
      if (!id) {
        const res = await fetch(cardId ? `${endpoint}/${cardId}` : endpoint, { method: cardId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyFromForm(form)) })
        const json = await res.json().catch(() => null) as Json
        if (!res.ok || !json?.data?.id) { setError(errorText(json, t('saveFailed'))); return }
        id = json.data.id
        warnings = json.meta?.warnings ?? []
        setSavedId(id)
      }
      const failed = await onSaved(id, warnings)
      if (failed) setError(t('notInBooking', { error: failed }))
    } catch {
      setError(t('network'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title={title} onClose={() => { if (!busy) onClose() }}
      footer={
        <div className="space-y-2">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
            <Button size="sm" onClick={save} disabled={busy || !form || !canSubmitPilgrim(form)}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {savedId ? t('retry') : saveLabel ?? t('saveAndUse')}
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{intro}</p>
        {form ? (
          <fieldset disabled={!!savedId} className="disabled:opacity-60">
            <SavedPilgrimFields value={form} onChange={setForm} showSelf={showSelf} idPrefix={idPrefix} />
          </fieldset>
        ) : !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</p>}
      </div>
    </Modal>
  )
}
