'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'

interface Props {
  bookingId: string
  /** Sudah ditandai selesai (status `completed`). */
  completed: boolean
  /** Keterangan "selesai pada … oleh …" (null untuk booking selesai lama tanpa penanda). */
  completedText: string | null
  /** Alasan belum bisa ditandai selesai (teks dari server; kosong = bisa). */
  blockers: string[]
  canReopen: boolean
  /** Sebut bagi hasil Platform Provider di konfirmasi — hanya superadmin (rincian internal, SEC-281). */
  showShareNote: boolean
}

// Tandai selesai / Buka kembali (Fase 13d, docs/arsitektur-bagi-hasil.md §5d). Syarat sungguhan dinilai ulang di server di dalam kunci (lib/booking/completion.ts).
export function CompletionBox({ bookingId, completed, completedText, blockers, canReopen, showShareNote }: Props) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: 'complete' | 'reopen') {
    setError('')
    const ok = action === 'complete'
      ? await ask({ title: 'Tandai pesanan ini selesai?', body: `Pesanan tidak dapat lagi direvisi atau diatur totalnya.${showShareNote ? ' Bagi hasil Platform Provider dihitung final memakai pengeluaran vendor yang tercatat saat ini.' : ''}`, confirmLabel: 'Ya, tandai selesai' })
      : await ask({ title: 'Buka kembali pesanan ini?', body: `Status kembali aktif.${showShareNote ? ' Bagi hasil kembali ke perhitungan rencana sampai ditandai selesai lagi.' : ''}`, confirmLabel: 'Ya, buka kembali' })
    if (!ok) return
    setBusy(true)
    const res = await fetch(`/api/v1/admin/bookings/${bookingId}/completion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }).catch(() => null)
    const json = res ? await res.json().catch(() => null) as { success?: boolean; error?: string } | null : null
    setBusy(false)
    if (!json?.success) { setError(json?.error ?? 'Gagal menyimpan'); return }
    router.refresh()
  }

  return (
    <div className="admin-card space-y-2 p-4">
      {dialog}
      <p className="admin-section">Penyelesaian</p>
      {completed ? (
        <>
          <p className="m-0 flex items-center gap-1.5 text-[13px] text-admin-ink"><CheckCircle2 className="h-4 w-4 text-admin-ok" /> {completedText ?? 'Pesanan selesai'}</p>
          {canReopen && (
            <button type="button" disabled={busy} onClick={() => run('reopen')} className="admin-btn-sm inline-flex items-center gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Buka kembali
            </button>
          )}
        </>
      ) : (
        <>
          {blockers.length > 0 ? (
            <ul className="m-0 list-disc pl-5 text-[12px] text-admin-muted">
              {blockers.map(b => <li key={b}>{b}</li>)}
            </ul>
          ) : (
            <p className="m-0 text-[12px] text-admin-muted">Pesanan lunas dan perjalanan sudah berakhir — dapat ditandai selesai.</p>
          )}
          <button type="button" disabled={busy || blockers.length > 0} onClick={() => run('complete')} className="admin-btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <CheckCircle2 className="h-3.5 w-3.5" /> Tandai selesai
          </button>
        </>
      )}
      {error && <p className="m-0 text-[12px] text-admin-danger">{error}</p>}
    </div>
  )
}
