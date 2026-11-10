'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, ClipboardCheck, FileSearch, Send, Undo2, X } from 'lucide-react'
import type { PilgrimReviewStatus } from '@prisma/client'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { FileViewerDialog } from '@/components/shared/documents/FileViewerDialog'
import type { FieldRow } from '@/lib/manifest/display'
import { REVIEW_LABEL, REVIEW_NOTE_MAX } from '@/lib/pilgrims/reviewState'
import { formatCalendarDate, formatInstant, DATE_LONG, DATETIME_LONG, type CalendarDate } from '@/lib/time'

// Pemeriksaan data jamaah booking oleh petugas (docs/arsitektur-jamaah.md §8.4, Fase 6): status pengajuan + riwayat, dokumen wajib dengan
// "Periksa" (popup FileViewerDialog: berkas + Terima / Tolak dengan alasan — berkas tak pernah dibuka di tab baru), lalu Verifikasi / Kembalikan (catatan wajib) / Ajukan atas nama pemesan. Semua aturan dinilai server (lib/pilgrims/review.ts).
export type ReviewDoc = {
  id: string; documentTypeId: string; label: string; trip: boolean; status: 'pending' | 'accepted' | 'rejected'
  rejectReason: 'not_matching' | 'expired' | 'unreadable' | 'other' | null; reviewNote: string | null; expiresAt: CalendarDate | null
  /** Status syarat dari evaluator kelengkapan (kedaluwarsa / kurang masa berlaku → saran alasan `expired`). */
  requirementState: string | null
}
export type ReviewEvent = { id: string; from: PilgrimReviewStatus | null; to: PilgrimReviewStatus; note: string | null; actorName: string | null; byStaff: boolean; byViewer: boolean; at: string }

type Props = {
  bookingId: string
  pilgrimId: string
  status: PilgrimReviewStatus
  active: boolean
  linked: boolean
  documents: ReviewDoc[]
  history: ReviewEvent[]
  /** Isian data jamaah sebagai teks (lib/manifest/display.ts `fieldRows`) — dicocokkan petugas dengan paspor/KTP. */
  data: FieldRow[]
  /** SEMUA syarat dokumen jamaah ini (termasuk yang belum diunggah); `reusable` = dokumen pribadi, selain itu dokumen perjalanan. */
  requirements: { documentTypeId: string; label: string; required: boolean; reusable: boolean }[]
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

export function PilgrimReviewPanel({ bookingId, pilgrimId, status, active, linked, documents, history, data, requirements }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [viewing, setViewing] = useState<ReviewDoc | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [docNote, setDocNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [note, setNote] = useState('')
  const base = `/api/v1/admin/bookings/${bookingId}/pilgrims/${pilgrimId}`
  // Pemisahan tugas (keputusan pemilik 2026-11-03): hanya mengingatkan bila pengajuan yang sedang ditinjau diajukan petugas ini sendiri.
  const selfSubmitted = status === 'submitted' && !!history.find(h => h.to === 'submitted')?.byViewer

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

  function openDoc(d: ReviewDoc) {
    setNotice(null); setViewing(d); setRejecting(false); setDocNote('')
    setReason(d.requirementState === 'expired' || d.requirementState === 'too_short' ? 'expired' : '')
  }

  async function acceptDoc() {
    if (viewing && await send(`${base}/documents/${viewing.id}/review`, 'PUT', { status: 'accepted' }, `${viewing.label} diterima.`)) setViewing(null)
  }

  async function rejectDoc() {
    if (!viewing) return
    if (await send(`${base}/documents/${viewing.id}/review`, 'PUT', { status: 'rejected', rejectReason: reason || null, note: docNote || null }, `${viewing.label} ditolak.`)) setViewing(null)
  }

  async function verify() {
    const body = 'Data dan dokumen jamaah ini dinyatakan benar. Data identitas jamaah diperbarui dari data yang diverifikasi.'
      + (selfSubmitted ? ' Pengajuan ini Anda ajukan sendiri — sebaiknya diperiksa petugas lain.' : '')
    if (!(await ask({ title: 'Verifikasi data jamaah?', body, confirmLabel: 'Verifikasi', tone: 'primary' }))) return
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

      {!linked && (
        <p className="m-0 rounded-md border border-dashed border-admin-line px-2.5 py-2 text-[12px] text-admin-muted">
          Belum tertaut ke kartu jamaah — tautkan atau buat lewat <span className="font-semibold text-admin-ink">Kelola data &amp; dokumen</span>.
        </p>
      )}

      <DataSummary rows={data} />

      {GROUPS.map(g => {
        const reqs = requirements.filter(r => r.reusable === g.reusable)
        if (reqs.length === 0) return null
        return (
          <div key={g.title} className="space-y-1.5">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">{g.title}</p>
            <ul className="m-0 list-none space-y-1.5 p-0">
              {reqs.flatMap(r => {
                const docs = documents.filter(d => d.documentTypeId === r.documentTypeId)
                if (docs.length === 0) return [(
                  <li key={r.documentTypeId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-admin-line px-2.5 py-2 text-[12px]">
                    <span className="text-admin-ink">{r.label}</span>
                    <Badge tone={r.required ? 'danger' : 'neutral'}>{r.required ? 'Wajib — belum diunggah' : 'Belum diunggah'}</Badge>
                  </li>
                )]
                return docs.map(d => (
                  <li key={d.id} className="space-y-1.5 rounded-md bg-admin-spot/60 px-2.5 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-admin-ink">
                      <span>
                        {d.label}
                        {d.expiresAt && <span className="text-admin-muted"> — berlaku s.d. {formatCalendarDate(d.expiresAt, DATE_LONG)}</span>}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Badge tone={DOC_TONE[d.status]}>{DOC_TEXT[d.status]}</Badge>
                        <Button size="sm" variant={active && d.status === 'pending' ? 'secondary' : 'ghost'} onClick={() => openDoc(d)} aria-label={`Periksa ${d.label}`}>
                          <FileSearch className="h-3.5 w-3.5" /> {active && d.status === 'pending' ? 'Periksa' : 'Lihat'}
                        </Button>
                      </span>
                    </div>
                    {d.status === 'rejected' && d.reviewNote && <p className="m-0 text-[11.5px] text-admin-danger">{d.reviewNote}</p>}
                  </li>
                ))
              })}
            </ul>
          </div>
        )
      })}

      {active && selfSubmitted && (
        <p className="m-0 flex items-start gap-1.5 rounded-md bg-admin-warning/10 px-2.5 py-2 text-[11.5px] text-admin-warning" role="note">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Anda yang mengajukan data ini atas nama pemesan. Sebaiknya diverifikasi petugas lain — tetap boleh dilanjutkan.
        </p>
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
      {viewing && (
        <FileViewerDialog
          title={`${viewing.label}${viewing.trip ? ' (perjalanan)' : ''}`}
          endpoint={`${base}/documents/${viewing.id}/review`}
          onClose={() => { if (!busy) setViewing(null) }}
          footer={active ? (
            <div className="space-y-2">
              {notice?.error && <p className="m-0 text-[12px] text-admin-danger" role="alert">{notice.text}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {rejecting ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setRejecting(false)} disabled={busy}>Batal</Button>
                    <Button size="sm" variant="danger" disabled={busy || !reason} onClick={rejectDoc}><X className="h-3.5 w-3.5" /> Tolak dokumen</Button>
                  </>
                ) : (
                  <>
                    {viewing.status !== 'rejected' && <Button size="sm" variant="danger" onClick={() => setRejecting(true)} disabled={busy}><X className="h-3.5 w-3.5" /> Tolak</Button>}
                    {viewing.status !== 'accepted' && <Button size="sm" onClick={acceptDoc} disabled={busy}><Check className="h-3.5 w-3.5" /> Terima</Button>}
                  </>
                )}
              </div>
            </div>
          ) : undefined}
        >
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-admin-muted">
            <Badge tone={DOC_TONE[viewing.status]}>{DOC_TEXT[viewing.status]}</Badge>
            {viewing.expiresAt && <span>Berlaku s.d. {formatCalendarDate(viewing.expiresAt, DATE_LONG)}</span>}
            {(viewing.requirementState === 'expired' || viewing.requirementState === 'too_short') && <span className="text-admin-danger">Masa berlaku tidak memenuhi syarat</span>}
          </div>
          {viewing.status === 'rejected' && viewing.reviewNote && <p className="m-0 text-[12px] text-admin-danger">Alasan sebelumnya: {viewing.reviewNote}</p>}
          <DataSummary rows={data} compact />
          {active && rejecting && (
            <div className="space-y-2 rounded-lg border border-admin-line p-3">
              <p className="m-0 text-[12px] font-semibold text-admin-ink">Alasan penolakan</p>
              <ChoiceSelect options={REASONS} value={reason} onChange={setReason} placeholder="Pilih alasan…" ariaLabel="Alasan penolakan" size="sm" />
              <textarea className="admin-inp min-h-16 w-full" value={docNote} onChange={e => setDocNote(e.target.value)} maxLength={1000} placeholder="Catatan untuk pemesan (opsional), mis. foto buram di bagian tanggal lahir" aria-label="Catatan penolakan" />
            </div>
          )}
        </FileViewerDialog>
      )}
      {dialog}
    </div>
  )
}

const GROUPS = [
  { title: 'Dokumen pribadi', reusable: true },
  { title: 'Dokumen perjalanan', reusable: false },
] as const

/** Isian data jamaah untuk dicocokkan dengan berkas; kolom wajib yang kosong ditandai (aturan sama dengan penolakan "Ajukan"). */
function DataSummary({ rows, compact = false }: { rows: FieldRow[]; compact?: boolean }) {
  if (rows.length === 0) return null
  const missing = rows.filter(r => r.missing).length
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">Data jamaah</p>
        {missing > 0 ? <Badge tone="danger">{missing} wajib belum diisi</Badge> : <Badge tone="ok">Lengkap</Badge>}
      </div>
      <dl className={`m-0 grid gap-x-3 gap-y-1 rounded-md bg-admin-spot/60 px-2.5 py-2 text-[12px] ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
        {rows.map(r => (
          <div key={r.key} className="flex min-w-0 justify-between gap-2">
            <dt className="shrink-0 text-admin-muted">{r.label}</dt>
            <dd className={`m-0 min-w-0 break-words text-right ${r.missing ? 'font-medium text-admin-danger' : r.value ? 'text-admin-ink' : 'text-admin-muted'}`}>
              {r.value ?? (r.missing ? 'Belum diisi' : '—')}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
