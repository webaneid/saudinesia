'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ClipboardCheck, FileSearch, Send, Undo2, X } from 'lucide-react'
import type { PilgrimReviewStatus } from '@prisma/client'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { REVIEW_LABEL, REVIEW_NOTE_MAX } from '@/lib/pilgrims/reviewState'
import { formatCalendarDate, formatInstant, DATE_LONG, DATETIME_LONG, type CalendarDate } from '@/lib/time'

// Pemeriksaan data jamaah booking oleh petugas (docs/arsitektur-jamaah.md §8.4, Fase 6): status pengajuan + riwayat, dokumen wajib dengan
// Lihat/Terima/Tolak, lalu Verifikasi / Kembalikan (catatan wajib) / Ajukan atas nama pemesan. Semua aturan dinilai server (lib/pilgrims/review.ts).
export type ReviewDoc = {
  id: string; label: string; trip: boolean; status: 'pending' | 'accepted' | 'rejected'
  rejectReason: 'not_matching' | 'expired' | 'unreadable' | 'other' | null; reviewNote: string | null; expiresAt: CalendarDate | null
  /** Status syarat dari evaluator kelengkapan (kedaluwarsa / kurang masa berlaku → saran alasan `expired`). */
  requirementState: string | null
}
export type ReviewEvent = { id: string; from: PilgrimReviewStatus | null; to: PilgrimReviewStatus; note: string | null; actorName: string | null; byStaff: boolean; at: string }

type Props = {
  bookingId: string
  pilgrimId: string
  status: PilgrimReviewStatus
  active: boolean
  linked: boolean
  documents: ReviewDoc[]
  history: ReviewEvent[]
}

const TONE: Record<PilgrimReviewStatus, BadgeTone> = { draft: 'neutral', submitted: 'warning', needs_revision: 'danger', verified: 'ok' }
const DOC_TONE = { pending: 'warning', accepted: 'ok', rejected: 'danger' } as const
const DOC_TEXT = { pending: 'Menunggu', accepted: 'Diterima', rejected: 'Ditolak' } as const
const REASONS = [
  { id: 'not_matching', label: 'Tidak sesuai' },
  { id: 'expired', label: 'Kedaluwarsa / masa berlaku kurang' },
  { id: 'unreadable', label: 'Tidak terbaca' },
  { id: 'other', label: 'Lainnya' },
]

export function PilgrimReviewPanel({ bookingId, pilgrimId, status, active, linked, documents, history }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [docNote, setDocNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const base = `/api/v1/admin/bookings/${bookingId}/pilgrims/${pilgrimId}`

  async function send(url: string, method: 'POST' | 'PUT', body: object | undefined, done: string): Promise<boolean> {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNotice({ text: json?.error ?? 'Gagal menyimpan.', error: true }); return false }
      setNotice({ text: done, error: false })
      router.refresh()
      return true
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
      return false
    } finally { setBusy(false) }
  }

  async function view(docId: string) {
    setNotice(null)
    const res = await fetch(`${base}/documents/${docId}/review`, { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.data?.url) { setNotice({ text: json?.error ?? 'Berkas tidak dapat dibuka.', error: true }); return }
    window.open(json.data.url, '_blank', 'noopener,noreferrer')
  }

  function startReject(d: ReviewDoc) {
    setRejecting(d.id); setDocNote('')
    setReason(d.requirementState === 'expired' || d.requirementState === 'too_short' ? 'expired' : '')
  }

  async function rejectDoc() {
    if (!rejecting) return
    if (await send(`${base}/documents/${rejecting}/review`, 'PUT', { status: 'rejected', rejectReason: reason || null, note: docNote || null }, 'Dokumen ditolak.')) setRejecting(null)
  }

  async function verify() {
    if (!(await ask({ title: 'Verifikasi data jamaah?', body: 'Data dan dokumen jamaah ini dinyatakan benar. Data identitas jamaah diperbarui dari data yang diverifikasi.', confirmLabel: 'Verifikasi', tone: 'primary' }))) return
    await send(`${base}/review`, 'POST', { decision: 'verified' }, 'Data jamaah terverifikasi.')
  }

  async function giveBack() {
    if (await send(`${base}/review`, 'POST', { decision: 'needs_revision', note }, 'Dikembalikan ke pemesan untuk diperbaiki.')) { setReturning(false); setNote('') }
  }

  return (
    <div className="space-y-3 rounded-lg border border-admin-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 flex items-center gap-1.5 text-[12px] font-semibold text-admin-ink"><ClipboardCheck className="h-3.5 w-3.5" /> Pemeriksaan data</p>
        <Badge tone={TONE[status]}>{REVIEW_LABEL[status]}</Badge>
      </div>

      {documents.length > 0 && (
        <ul className="m-0 list-none space-y-1.5 p-0">
          {documents.map(d => (
            <li key={d.id} className="space-y-1.5 rounded-md bg-admin-spot/60 px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-admin-ink">
                <span>
                  {d.label}{d.trip ? ' (perjalanan)' : ''}
                  {d.expiresAt && <span className="text-admin-muted"> — berlaku s.d. {formatCalendarDate(d.expiresAt, DATE_LONG)}</span>}
                </span>
                <span className="flex items-center gap-1.5">
                  <Badge tone={DOC_TONE[d.status]}>{DOC_TEXT[d.status]}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => view(d.id)} aria-label={`Lihat ${d.label}`}><FileSearch className="h-3.5 w-3.5" /></Button>
                  {active && d.status !== 'accepted' && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => send(`${base}/documents/${d.id}/review`, 'PUT', { status: 'accepted' }, 'Dokumen diterima.')} aria-label={`Terima ${d.label}`}><Check className="h-3.5 w-3.5" /></Button>
                  )}
                  {active && d.status !== 'rejected' && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => startReject(d)} aria-label={`Tolak ${d.label}`}><X className="h-3.5 w-3.5" /></Button>
                  )}
                </span>
              </div>
              {d.status === 'rejected' && d.reviewNote && <p className="m-0 text-[11.5px] text-admin-danger">{d.reviewNote}</p>}
              {rejecting === d.id && (
                <div className="flex flex-wrap items-center gap-2">
                  <ChoiceSelect options={REASONS} value={reason} onChange={setReason} placeholder="Alasan penolakan…" ariaLabel="Alasan penolakan" size="sm" className="min-w-52" />
                  <input className="admin-inp min-w-52 flex-1" value={docNote} onChange={e => setDocNote(e.target.value)} maxLength={1000} placeholder="Catatan untuk pemesan (opsional)" aria-label="Catatan penolakan" />
                  <Button size="sm" variant="danger" disabled={busy || !reason} onClick={rejectDoc}>Tolak</Button>
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Batal</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {active && (
        returning ? (
          <div className="space-y-2">
            <textarea className="admin-inp min-h-20 w-full" value={note} onChange={e => setNote(e.target.value)} maxLength={REVIEW_NOTE_MAX}
              placeholder="Apa yang perlu diperbaiki pemesan? (tampil di halaman booking pemesan)" aria-label="Catatan perbaikan" />
            <div className="flex gap-2">
              <Button size="sm" variant="danger" disabled={busy || !note.trim()} onClick={giveBack}><Undo2 className="h-3.5 w-3.5" /> Kembalikan</Button>
              <Button size="sm" variant="ghost" onClick={() => setReturning(false)}>Batal</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {status === 'submitted' && <Button size="sm" disabled={busy} onClick={verify}><Check className="h-3.5 w-3.5" /> Verifikasi</Button>}
            {status === 'submitted' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setReturning(true)}><Undo2 className="h-3.5 w-3.5" /> Kembalikan</Button>}
            {(status === 'draft' || status === 'needs_revision') && (
              <Button size="sm" variant="secondary" disabled={busy || !linked} onClick={() => send(`${base}/submit`, 'POST', undefined, 'Diajukan atas nama pemesan.')}>
                <Send className="h-3.5 w-3.5" /> Ajukan atas nama pemesan
              </Button>
            )}
          </div>
        )
      )}
      {notice && <p className={`m-0 text-[12px] ${notice.error ? 'text-admin-danger' : 'text-admin-muted'}`} role="status">{notice.text}</p>}

      {history.length > 0 && (
        <details className="text-[11.5px] text-admin-muted">
          <summary className="cursor-pointer">Riwayat pemeriksaan ({history.length})</summary>
          <ol className="m-0 mt-1.5 list-none space-y-1 p-0">
            {history.map(h => (
              <li key={h.id}>
                <span className="text-admin-ink">{REVIEW_LABEL[h.to]}</span> · {formatInstant(new Date(h.at), DATETIME_LONG)}
                {h.actorName ? ` · ${h.actorName}` : h.byStaff ? ' · petugas' : ' · pemesan'}
                {h.note && <span className="block text-admin-ink/80">{h.note}</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      {dialog}
    </div>
  )
}
