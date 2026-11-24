'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/shared/Modal'
import { SavedPilgrimFields } from '@/components/shared/pilgrims/SavedPilgrimFields'
import { bodyFromForm, canSubmitPilgrim, formFromCard, missingRequired, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import { withRequiredAddress } from '@/components/shared/pilgrims/cardFields'
import { useFieldLabel } from '@/components/shared/pilgrims/useFieldLabel'
import { usePilgrimFields } from '@/components/shared/pilgrims/usePilgrimFields'
import type { ManifestRole } from '@/lib/manifest/roles'
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
  /** Kolom wajib katalog DAN alamat harus terisi dulu (popup "Jadikan saya jamaah", docs/rencana-profil-jamaah.md P3). */
  requireComplete?: boolean
  /** Pemberitahuan di bawah kalimat pembuka. */
  notice?: ReactNode
  onClose: () => void
  /** Dipanggil sesudah kartu tersimpan; mengembalikan pesan galat bila langkah berikutnya (tautkan/salin ke booking) gagal. */
  onSaved: (cardId: string, warnings: PilgrimWarning[]) => Promise<string | null>
}

type Json = { data?: Record<string, unknown> & { id?: string }; error?: string; meta?: { warnings?: PilgrimWarning[] } } | null

export function PilgrimCardDialog({ endpoint, cardId, intro, idPrefix, title, initial, showSelf, saveLabel, requireComplete = false, notice, onClose, onSaved }: Props) {
  const t = useTranslations('shared.pilgrims.dialog')
  const errorText = useApiError()
  const labelOf = useFieldLabel()
  const [form, setForm] = useState<SavedPilgrimFormValue | null>(cardId ? null : initial ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Kartu sudah tersimpan tapi langkah berikutnya gagal: jangan simpan ulang (membuat kartu ganda) — hanya ulangi langkah itu.
  const [savedId, setSavedId] = useState<string | null>(null)

  const loaded = usePilgrimFields()
  const tf = useTranslations('shared.pilgrims.fields')
  // Alamat wajib saat pemesan mendaftar sebagai jamaah (keputusan pemilik 2026-11-25) walau kolomnya nonaktif di katalog.
  const fields = useMemo(() => (loaded && requireComplete ? withRequiredAddress(loaded, tf('address')) : loaded), [loaded, requireComplete, tf])
  const missing = requireComplete && form && fields ? missingRequired(form, fields) : []
  const ready = !!form && fields !== undefined && canSubmitPilgrim(form) && missing.length === 0

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
    if (!form || !ready || busy) return
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
          {missing.length > 0 && <p className="text-sm text-amber-800">{t('required', { fields: missing.map(f => labelOf(f.role as ManifestRole | null, f)).join(', ') })}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
            <Button size="sm" onClick={save} disabled={busy || !ready}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {savedId ? t('retry') : saveLabel ?? t('saveAndUse')}
            </Button>
          </div>
        </div>
      }>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{intro}</p>
        {notice}
        {form && fields !== undefined ? (
          <fieldset disabled={!!savedId} className="disabled:opacity-60">
            <SavedPilgrimFields value={form} onChange={setForm} showSelf={showSelf} idPrefix={idPrefix} fields={fields ?? undefined} />
          </fieldset>
        ) : !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t('loading')}</p>}
      </div>
    </Modal>
  )
}
