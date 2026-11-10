'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Circle, Clock, Loader2, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/shared/Modal'
import { DataTable, type Column } from '@/components/shared/data-table/DataTable'
import { ActionLink, KindButton, RowActions } from '@/components/shared/data-table/RowActions'
import { REVIEW_LABEL, REVIEW_TONE, isReviewLocked } from '@/lib/pilgrims/reviewState'
import type { PilgrimSlot } from '@/lib/pilgrims/slotTypes'

// Tabel jamaah satu booking (pemilik 2026-11-10) — SATU komponen untuk halaman booking jamaah dan admin (tanpa impor admin). Hanya slot yang
// sudah diisi yang tampil; slot kosong berikutnya diisi lewat tombol "Tambah jamaah" (jumlah slot = yang ditagih — menambah/mengurangi orang
// = revisi booking oleh admin). Aksi ikon + tooltip: Lihat (popup ringkasan, atau tautan pemeriksaan di admin), Edit (halaman satu jamaah),
// Hapus (KOSONGKAN slot — server: clearSlot; ditolak selama diperiksa/terverifikasi).

export type SlotRow = Omit<PilgrimSlot, 'card'> & {
  editHref: string
  /** Ada = Lihat menuju tautan ini (admin: Pemeriksaan data); tidak ada = popup ringkasan. */
  viewHref?: string
}

type Props = {
  total: number
  slots: SlotRow[]
  /** Halaman isi slot kosong pertama (null = semua terisi, atau booking tak aktif). */
  addHref: string | null
  /** Endpoint DELETE pengosong slot, `{id}` diganti id jamaah; null = tak bisa menghapus (booking tak aktif). */
  deleteEndpoint: string | null
}

const DONE = new Set(['pending', 'accepted'])

function DocIcon({ state }: { state: string }) {
  if (state === 'accepted') return <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" aria-hidden />
  if (state === 'pending') return <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
  if (state === 'missing') return <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
  return <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
}

export function PilgrimSlotsTable({ total, slots, addHref, deleteEndpoint }: Props) {
  const router = useRouter()
  const [viewing, setViewing] = useState<SlotRow | null>(null)
  const [deleting, setDeleting] = useState<SlotRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filled = slots.filter(s => s.filled)
  const ready = slots.filter(s => s.ready).length
  const nameOf = (s: SlotRow) => s.name ?? `Jamaah ${s.no}`

  async function clear() {
    if (!deleting || !deleteEndpoint) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(deleteEndpoint.replace('{id}', deleting.id), { method: 'DELETE' })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setError(json?.error ?? 'Jamaah gagal dihapus.'); return }
      setDeleting(null)
      router.refresh()
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally { setBusy(false) }
  }

  const columns: Column<SlotRow>[] = [
    { key: 'no', header: 'No', cell: s => <span className="tabular-nums text-muted-foreground">{s.no}</span> },
    { key: 'name', header: 'Nama jamaah', mobile: 'title', cell: s => <span className="font-medium">{nameOf(s)}</span> },
    {
      key: 'data', header: 'Data', cell: s => s.data.complete
        ? <Badge variant="success">Lengkap</Badge>
        : <Badge variant="warning">{s.data.filled}/{s.data.required} wajib</Badge>,
    },
    {
      key: 'docs', header: 'Dokumen', cell: s => s.docs.required === 0
        ? <span className="text-muted-foreground">—</span>
        : <Badge variant={s.docs.done === s.docs.required ? 'success' : 'warning'}>{s.docs.done}/{s.docs.required}</Badge>,
    },
    { key: 'status', header: 'Status', cell: s => <Badge variant={REVIEW_TONE[s.reviewStatus]}>{REVIEW_LABEL[s.reviewStatus]}</Badge> },
    {
      key: 'actions', header: '', actions: true, cell: s => {
        const locked = isReviewLocked(s.reviewStatus)
        return (
          <RowActions>
            {s.viewHref
              ? <ActionLink kind="view" href={s.viewHref} label={`Periksa ${nameOf(s)}`} />
              : <KindButton kind="view" label={`Lihat ${nameOf(s)}`} onClick={() => setViewing(s)} />}
            <ActionLink kind="edit" href={s.editHref} label={locked ? `Buka ${nameOf(s)} (dikunci selama diperiksa)` : `Edit ${nameOf(s)}`} />
            {deleteEndpoint && (
              <KindButton kind="delete" label={locked ? 'Tidak bisa dihapus selama diperiksa' : `Hapus ${nameOf(s)}`} disabled={locked}
                onClick={() => { setError(null); setDeleting(s) }} />
            )}
          </RowActions>
        )
      },
    },
  ]

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p className="font-medium"><span className="tabular-nums">{ready}/{total}</span> jamaah lengkap</p>
          <p className="text-xs text-muted-foreground tabular-nums">{filled.length} dari {total} sudah diisi</p>
        </div>
        {/* Satu segmen per slot: hijau = lengkap, kuning = diisi belum lengkap, abu = kosong. */}
        <div className="flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-label="Jamaah lengkap">
          {slots.map(s => <span key={s.id} className={`h-2 flex-1 rounded-full ${s.ready ? 'bg-primary' : s.filled ? 'bg-amber-400' : 'bg-muted'}`} />)}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={filled}
        getRowId={s => s.id}
        empty={<span className="text-muted-foreground">Belum ada jamaah yang diisi.</span>}
      />

      {addHref && (
        <Button asChild size="sm">
          <Link href={addHref}><UserPlus className="mr-1.5 h-4 w-4" /> Tambah jamaah ({filled.length + 1}/{total})</Link>
        </Button>
      )}

      {viewing && (
        <Modal open title={nameOf(viewing)} onClose={() => setViewing(null)}
          footer={<Button asChild size="sm"><Link href={viewing.editHref}>{isReviewLocked(viewing.reviewStatus) ? 'Buka halaman jamaah' : 'Edit jamaah'}</Link></Button>}>
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={REVIEW_TONE[viewing.reviewStatus]}>{REVIEW_LABEL[viewing.reviewStatus]}</Badge>
              <Badge variant={viewing.data.complete ? 'success' : 'warning'}>Data {viewing.data.filled}/{viewing.data.required}</Badge>
              {viewing.docs.required > 0 && <Badge variant={viewing.docs.done === viewing.docs.required ? 'success' : 'warning'}>Dokumen {viewing.docs.done}/{viewing.docs.required}</Badge>}
            </div>
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              {viewing.rows.map(r => (
                <div key={r.key} className="flex justify-between gap-3 border-b py-1">
                  <dt className="text-muted-foreground">{r.label}</dt>
                  <dd className={r.missing ? 'font-medium text-destructive' : 'text-right'}>{r.value ?? (r.missing ? 'Wajib diisi' : '—')}</dd>
                </div>
              ))}
            </dl>
            {viewing.documents.length > 0 && (
              <ul className="space-y-1.5">
                {viewing.documents.map(d => (
                  <li key={d.key} className="flex items-center gap-2">
                    <DocIcon state={d.state} />
                    <span className="flex-1">{d.label}{d.required ? '' : ' (opsional)'}</span>
                    <span className="text-xs text-muted-foreground">{DONE.has(d.state) ? (d.state === 'accepted' ? 'Diterima' : 'Diunggah') : d.state === 'missing' ? 'Belum diunggah' : 'Perlu diganti'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal open title={`Hapus ${nameOf(deleting)}?`} onClose={() => !busy && setDeleting(null)}
          footer={(
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)} disabled={busy}>Batal</Button>
              <Button variant="destructive" size="sm" onClick={clear} disabled={busy}>{busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Ya, kosongkan</Button>
            </div>
          )}>
          <div className="space-y-2 text-sm">
            <p>Isian jamaah ini di booking dikosongkan dan tautannya ke data jamaah tersimpan dilepas. Slot tetap ada untuk diisi orang lain — jumlah jamaah dan tagihan tidak berubah.</p>
            <p className="text-muted-foreground">Data di Jamaah Saya (kartu dan dokumen pribadinya) tidak ikut terhapus.</p>
            {error && <p role="alert" className="font-medium text-destructive">{error}</p>}
          </div>
        </Modal>
      )}
    </div>
  )
}
