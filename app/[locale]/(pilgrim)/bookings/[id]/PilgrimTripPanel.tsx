'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { AlertCircle, FolderOpen, Link2, Pencil, Plus, Send, Unlink, UserCheck } from 'lucide-react'
import type { PilgrimReviewStatus } from '@prisma/client'
import type { PilgrimWarning } from '@/lib/pilgrims/service'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { isReviewLocked, REVIEW_TONE } from '@/lib/pilgrims/reviewState'
import { contactFromStored } from '@/components/shared/ContactPicker'
import type { AddressValue } from '@/components/shared/AddressPicker'
import { EMPTY_PILGRIM_FORM, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import { PilgrimCardDialog } from '@/components/shared/pilgrims/PilgrimCardDialog'
import { DocumentChecklist, type ChecklistItemView } from '@/components/shared/documents/DocumentChecklist'
import { useApiError } from '@/components/shared/useApiError'

// Data & dokumen satu jamaah di booking milik jamaah (docs/arsitektur-jamaah.md §5.5 butir 2): pilih dari Jamaah Saya (snapshot); "Ubah data jamaah"
// = popup kartu yang sama dengan "Tambah", sesudah disimpan kartu langsung disalin ulang ke booking ini (tak perlu keluar halaman), kelengkapan dokumen (DocumentChecklist: progres + unggah dalam popup, dokumen pribadi ke kartu, dokumen perjalanan ke booking ini).

type Props = {
  locale: string
  bookingId: string
  pilgrimId: string
  linked: { id: string; name: string } | null
  checklist: ChecklistItemView[]
  /** Pemeriksaan petugas (Fase 6): `ready` = dokumen wajib siap (server); `note` = catatan perbaikan terakhir. */
  review: { status: PilgrimReviewStatus; open: boolean; ready: boolean; note: string | null }
  /** Pemesan sebagai jamaah: kartu "Saya sendiri" (bila ada), sudah dipakai di booking ini, dan data akun untuk mengisi kartu baru. */
  self: { cardId: string | null; usedHere: boolean; fullName: string; email: string; phone: string | null; whatsapp: string | null; address: AddressValue | null }
  /** Kolom data wajib yang masih kosong (`fromCard` = bisa diisi lewat Ubah data jamaah). */
  missingFields: { label: string; fromCard: boolean }[]
}

export function PilgrimTripPanel({ locale, bookingId, pilgrimId, linked, checklist, review, self, missingFields }: Props) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.trip')
  const tr = useTranslations('shared.review')
  const tw = useTranslations('shared.pilgrims.warning')
  const errorText = useApiError()
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [creating, setCreating] = useState<'new' | 'self' | 'edit' | null>(null)
  const base = `/api/v1/bookings/${bookingId}/pilgrims/${pilgrimId}`

  useEffect(() => {
    if (linked) return
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/v1/account/pilgrims?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((j: { success: boolean; data?: { id: string; fullName: string; isSelf: boolean }[] }) =>
        setOptions((j.data ?? []).map(c => ({ id: c.id, label: c.fullName, hint: c.isSelf ? t('selfBadge') : undefined }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [q, linked, t])

  /** Mengembalikan pesan galat (null = berhasil). */
  async function call(method: 'PUT' | 'DELETE' | 'POST', body: object | undefined, done: string, path = 'card'): Promise<string | null> {
    setBusy(true); setNotice(null); setConfirming(false)
    try {
      const res = await fetch(`${base}/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { const text = errorText(json, t('saveFailed')); setNotice({ text, error: true }); return text }
      setNotice({ text: done, error: false })
      setCardId('')
      setCreating(null)
      router.refresh()
      return null
    } catch {
      setNotice({ text: t('network'), error: true })
      return t('network')
    } finally { setBusy(false) }
  }

  // Kartu baru dari formulir sebaris → langsung dipakai untuk jamaah ini.
  const linkNew = (id: string, warnings: PilgrimWarning[]) =>
    call('PUT', { cardId: id }, [t('linkedNew'), ...warnings.map(w => tw(w))].join(' '))
  // "Jadikan saya jamaah": kartu "Saya sendiri" yang sudah ada langsung dipakai; belum ada → formulir terisi dari data akun.
  function pickSelf() {
    if (self.cardId) { void call('PUT', { cardId: self.cardId }, t('selfDone')); return }
    setNotice(null); setCreating('self')
  }
  const selfForm = (): SavedPilgrimFormValue => ({
    ...EMPTY_PILGRIM_FORM, fullName: self.fullName, email: self.email, isSelf: true, contact: contactFromStored(self.phone ?? '', self.whatsapp ?? ''),
    ...(self.address ? { address: self.address } : {}),
  })

  const locked = isReviewLocked(review.status)
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('reviewTitle')}</span>
          <Badge variant={REVIEW_TONE[review.status]}>{tr(review.status)}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{t(`hint.${review.status}`)}</p>
        {review.note && <p className="text-sm text-destructive whitespace-pre-line">{review.note}</p>}
        {review.open && (review.status === 'draft' || review.status === 'needs_revision') && (
          <Button size="sm" onClick={() => call('POST', undefined, t('submitted'), 'submit')} disabled={busy || !linked || !review.ready || missingFields.length > 0}>
            <Send className="h-4 w-4" /> {t('submit')}
          </Button>
        )}
      </div>

      {linked && missingFields.length > 0 && (
        <div className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-2">
            <p>{t.rich('incomplete', { fields: missingFields.map(f => f.label).join(', '), b: c => <span className="font-medium">{c}</span> })}</p>
            {missingFields.some(f => f.fromCard) && !locked && (
              <Button size="sm" variant="outline" onClick={() => { setNotice(null); setCreating('edit') }} disabled={busy}><Pencil className="h-4 w-4" /> {t('completeNow')}</Button>
            )}
            {missingFields.some(f => !f.fromCard) && <p className="text-xs">{t('extraHint')}</p>}
          </div>
        </div>
      )}

      {linked ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/${locale}/jamaah/${linked.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <FolderOpen className="h-4 w-4" /> {t('manage', { name: linked.name })}
            </Link>
          </div>
          {locked ? null : confirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span>{t('unlinkConfirm')}</span>
              <Button size="sm" disabled={busy} onClick={() => call('DELETE', undefined, t('unlinked'))}>{t('unlinkYes')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>{t('cancel')}</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => { setNotice(null); setCreating('edit') }} disabled={busy}><Pencil className="h-4 w-4" /> {t('edit')}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(true)} disabled={busy}><Unlink className="h-4 w-4" /> {t('unlink')}</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('pickIntro')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <AutocompleteSelect options={options} value={cardId} onChange={v => setCardId(v ?? '')} onSearch={setQ} loading={loading}
              placeholder={t('pickPlaceholder')} ariaLabel={t('pickAria')} className="min-w-0 flex-1 sm:min-w-64 sm:flex-none" />
            <Button size="sm" onClick={() => call('PUT', { cardId }, t('filled'))} disabled={busy || !cardId}><Link2 className="h-4 w-4" /> {t('use')}</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!self.usedHere && <Button size="sm" variant="outline" onClick={pickSelf} disabled={busy}><UserCheck className="h-4 w-4" /> {t('self')}</Button>}
            <Button size="sm" variant="outline" onClick={() => { setNotice(null); setCreating('new') }} disabled={busy}><Plus className="h-4 w-4" /> {t('addNew')}</Button>
          </div>
        </div>
      )}
      {creating === 'edit' && linked && (
        <PilgrimCardDialog
          endpoint="/api/v1/account/pilgrims"
          cardId={linked.id}
          intro={t('editIntro')}
          idPrefix={`sp-${pilgrimId}`}
          title={t('edit')}
          showSelf={!self.cardId || self.cardId === linked.id}
          saveLabel={t('save')}
          onClose={() => setCreating(null)}
          onSaved={(id, warnings) => call('PUT', { cardId: id }, [t('updated'), ...warnings.map(w => tw(w))].join(' '))}
        />
      )}
      {(creating === 'new' || creating === 'self') && (
        <PilgrimCardDialog
          endpoint="/api/v1/account/pilgrims"
          intro={t('newIntro')}
          idPrefix={`sp-${pilgrimId}`}
          title={creating === 'self' ? t('selfTitle') : t('addNew')}
          initial={creating === 'self' ? selfForm() : EMPTY_PILGRIM_FORM}
          showSelf={creating === 'new' && !self.cardId}
          onClose={() => setCreating(null)}
          onSaved={linkNew}
        />
      )}
      {notice && <p className={`text-sm ${notice.error ? 'text-destructive' : 'text-muted-foreground'}`} role="status">{notice.text}</p>}

      <DocumentChecklist items={checklist} card={linked} endpoints={linked ? { personal: `/api/v1/account/pilgrims/${linked.id}/documents`, trip: `${base}/documents` } : null} />
    </div>
  )
}
