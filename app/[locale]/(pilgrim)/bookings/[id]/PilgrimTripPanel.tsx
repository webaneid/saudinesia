'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FolderOpen, Link2, Plus, RefreshCw, Send, Unlink, UserCheck } from 'lucide-react'
import type { PilgrimReviewStatus } from '@prisma/client'
import type { PilgrimWarning } from '@/lib/pilgrims/service'
import { AutocompleteSelect, type AutocompleteOption } from '@/components/shared/AutocompleteSelect'
import { DocumentRepeater } from '@/components/shared/documents/DocumentRepeater'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { checklistState, type ChecklistTone } from '@/lib/documents/checklistLabels'
import { isReviewLocked, REVIEW_LABEL, REVIEW_TONE } from '@/lib/pilgrims/reviewState'
import { contactFromStored } from '@/components/shared/ContactPicker'
import { EMPTY_PILGRIM_FORM, type SavedPilgrimFormValue } from '@/components/shared/pilgrims/savedPilgrimForm'
import { WARNING_TEXT } from '@/components/shared/pilgrims/warningText'
import { InlinePilgrimForm } from './InlinePilgrimForm'

// Data & dokumen satu jamaah di booking milik jamaah (docs/arsitektur-jamaah.md §5.5 butir 2): pilih dari Jamaah Saya (snapshot — mengedit kartu
// kemudian tidak mengubah booking sampai "Perbarui"), checklist kelengkapan (dihitung server), dan dokumen per perjalanan. Paspor/KTP diunggah di kartu.
export type TripChecklistItem = { key: string; label: string; required: boolean; state: string; sources: string[] }

type Props = {
  locale: string
  bookingId: string
  pilgrimId: string
  linked: { id: string; name: string } | null
  checklist: TripChecklistItem[]
  /** Pemeriksaan petugas (Fase 6): `ready` = dokumen wajib siap (server); `note` = catatan perbaikan terakhir. */
  review: { status: PilgrimReviewStatus; open: boolean; ready: boolean; note: string | null }
  /** Pemesan sebagai jamaah: kartu "Saya sendiri" (bila ada), sudah dipakai di booking ini, dan data akun untuk mengisi kartu baru. */
  self: { cardId: string | null; usedHere: boolean; fullName: string; email: string; phone: string | null; whatsapp: string | null }
}

const VARIANT: Record<ChecklistTone, 'success' | 'warning' | 'destructive' | 'muted'> = { ok: 'success', warning: 'warning', danger: 'destructive', neutral: 'muted' }
const REVIEW_HINT: Record<PilgrimReviewStatus, string> = {
  draft: 'Setelah data dan dokumen lengkap, ajukan untuk diperiksa petugas.',
  submitted: 'Sedang diperiksa petugas. Data jamaah dikunci selama pemeriksaan; mengganti dokumen membuat pemeriksaan diulang.',
  needs_revision: 'Petugas meminta perbaikan. Perbaiki lalu ajukan lagi.',
  verified: 'Data jamaah ini sudah diverifikasi petugas.',
}

export function PilgrimTripPanel({ locale, bookingId, pilgrimId, linked, checklist, review, self }: Props) {
  const router = useRouter()
  const [options, setOptions] = useState<AutocompleteOption[]>([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [cardId, setCardId] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'refresh' | 'unlink' | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [creating, setCreating] = useState<'new' | 'self' | null>(null)
  const base = `/api/v1/bookings/${bookingId}/pilgrims/${pilgrimId}`

  useEffect(() => {
    if (linked) return
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/v1/account/pilgrims?limit=20${q ? `&q=${encodeURIComponent(q)}` : ''}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then((j: { success: boolean; data?: { id: string; fullName: string; isSelf: boolean }[] }) =>
        setOptions((j.data ?? []).map(c => ({ id: c.id, label: c.fullName, hint: c.isSelf ? 'Saya sendiri' : undefined }))))
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [q, linked])

  /** Mengembalikan pesan galat (null = berhasil). */
  async function call(method: 'PUT' | 'DELETE' | 'POST', body: object | undefined, done: string, path = 'card'): Promise<string | null> {
    setBusy(true); setNotice(null); setConfirming(null)
    try {
      const res = await fetch(`${base}/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { const text = json?.error ?? 'Gagal menyimpan.'; setNotice({ text, error: true }); return text }
      setNotice({ text: done, error: false })
      setCardId('')
      setCreating(null)
      router.refresh()
      return null
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
      return 'Tidak dapat menghubungi server.'
    } finally { setBusy(false) }
  }

  // Kartu baru dari formulir sebaris → langsung dipakai untuk jamaah ini.
  const linkNew = (id: string, warnings: PilgrimWarning[]) =>
    call('PUT', { cardId: id }, ['Data jamaah tersimpan dan terpasang. Unggah paspor/KTP lewat tautan Jamaah Saya di atas.', ...warnings.map(w => WARNING_TEXT[w])].join(' '))
  // "Jadikan saya jamaah": kartu "Saya sendiri" yang sudah ada langsung dipakai; belum ada → formulir terisi dari data akun.
  function pickSelf() {
    if (self.cardId) { void call('PUT', { cardId: self.cardId }, 'Anda terdaftar sebagai jamaah ini.'); return }
    setNotice(null); setCreating('self')
  }
  const selfForm = (): SavedPilgrimFormValue => ({
    ...EMPTY_PILGRIM_FORM, fullName: self.fullName, email: self.email, isSelf: true, contact: contactFromStored(self.phone ?? '', self.whatsapp ?? ''),
  })

  const locked = isReviewLocked(review.status)
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium">Pemeriksaan data</span>
          <Badge variant={REVIEW_TONE[review.status]}>{REVIEW_LABEL[review.status]}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{REVIEW_HINT[review.status]}</p>
        {review.note && <p className="text-sm text-destructive whitespace-pre-line">{review.note}</p>}
        {review.open && (review.status === 'draft' || review.status === 'needs_revision') && (
          <Button size="sm" onClick={() => call('POST', undefined, 'Data jamaah diajukan untuk diperiksa.', 'submit')} disabled={busy || !linked || !review.ready}>
            <Send className="h-4 w-4" /> Ajukan untuk diperiksa
          </Button>
        )}
      </div>

      {linked ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/${locale}/jamaah/${linked.id}`} className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline">
              <FolderOpen className="h-4 w-4" /> {linked.name} — kelola data & dokumen di Jamaah Saya
            </Link>
          </div>
          {locked ? null : confirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <span>{confirming === 'refresh'
                ? 'Ganti data jamaah di booking ini dengan isi Jamaah Saya saat ini?'
                : 'Lepas tautan? Data jamaah di booking ini tetap seperti sekarang.'}</span>
              <Button size="sm" disabled={busy}
                onClick={() => confirming === 'refresh'
                  ? call('PUT', { cardId: linked.id }, 'Data jamaah diperbarui dari Jamaah Saya.')
                  : call('DELETE', undefined, 'Tautan dilepas.')}>
                Ya, lanjutkan
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={busy}>Batal</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setConfirming('refresh')} disabled={busy}><RefreshCw className="h-4 w-4" /> Perbarui dari Jamaah Saya</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming('unlink')} disabled={busy}><Unlink className="h-4 w-4" /> Lepas</Button>
            </div>
          )}
        </div>
      ) : creating ? (
        <InlinePilgrimForm
          idPrefix={`sp-${pilgrimId}`}
          title={creating === 'self' ? 'Data Anda sebagai jamaah' : 'Tambah jamaah baru'}
          initial={creating === 'self' ? selfForm() : EMPTY_PILGRIM_FORM}
          showSelf={creating === 'new' && !self.cardId}
          onCancel={() => setCreating(null)}
          onSaved={linkNew}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Pilih data jamaah ini dari Jamaah Saya — data dan dokumennya terisi otomatis.</p>
          <div className="flex flex-wrap items-center gap-2">
            <AutocompleteSelect options={options} value={cardId} onChange={v => setCardId(v ?? '')} onSearch={setQ} loading={loading}
              placeholder="Pilih dari Jamaah Saya…" ariaLabel="Jamaah Saya" className="min-w-0 flex-1 sm:min-w-64 sm:flex-none" />
            <Button size="sm" onClick={() => call('PUT', { cardId }, 'Data jamaah terisi dari Jamaah Saya.')} disabled={busy || !cardId}><Link2 className="h-4 w-4" /> Pakai</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!self.usedHere && <Button size="sm" variant="outline" onClick={pickSelf} disabled={busy}><UserCheck className="h-4 w-4" /> Jadikan saya jamaah</Button>}
            <Button size="sm" variant="outline" onClick={() => { setNotice(null); setCreating('new') }} disabled={busy}><Plus className="h-4 w-4" /> Tambah jamaah baru</Button>
          </div>
        </div>
      )}
      {notice && <p className={`text-sm ${notice.error ? 'text-destructive' : 'text-muted-foreground'}`} role="status">{notice.text}</p>}

      {checklist.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Kelengkapan dokumen</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {checklist.map(c => {
              const st = checklistState(c.state)
              return (
                <li key={c.key} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    {c.label}{c.required ? '' : ' (opsional)'}
                    {c.sources.length > 0 && <span className="block text-xs text-muted-foreground">Diminta oleh: {c.sources.join(', ')}</span>}
                  </span>
                  <Badge variant={VARIANT[st.tone]}>{st.label}</Badge>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {linked && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Dokumen perjalanan ini (tiket, reservasi). Paspor, KTP, dan dokumen pribadi diunggah di Jamaah Saya.</p>
          <DocumentRepeater endpoint={`${base}/documents`} />
        </div>
      )}
    </div>
  )
}
