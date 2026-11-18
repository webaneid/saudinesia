'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { formatRupiah } from '@/lib/utils'

// Batalkan pencairan bagi hasil (Fase 13e-1): alasan wajib, konfirmasi, lalu server menandai batal + membalik entri buku kas (saldo bagi hasil naik lagi).
export function VoidPayout({ id, amount }: { id: string; amount: number }) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (!(await ask({ title: `Batalkan pencairan ${formatRupiah(amount)}?`, body: 'Entri pembalik dicatat di buku kas dan saldo bagi hasil kembali bertambah. Pencairan yang dibatalkan tidak bisa diaktifkan lagi — catat pencairan baru bila perlu.', confirmLabel: 'Ya, batalkan' }))) return
    setBusy(true); setError('')
    try {
      const res = await fetch(`/api/v1/admin/system/platform-provider/payouts/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void', reason: reason.trim() }) })
      const json = await res.json().catch(() => null) as { success?: boolean; error?: string } | null
      if (!res.ok || !json?.success) { setError(json?.error ?? 'Gagal membatalkan pencairan.'); return }
      setOpen(false); router.refresh()
    } catch { setError('Tidak dapat menghubungi server.') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      {dialog}
      {!open
        ? <button type="button" className="admin-btn-ghost text-sm text-admin-danger" onClick={() => { setOpen(true); setError('') }}><Undo2 className="size-4" /> Batalkan pencairan</button>
        : (
          <div className="admin-form-panel space-y-3">
            <label className="block"><span className="mb-1 block text-xs text-admin-muted">Alasan pembatalan (internal — tanpa data pelanggan)</span>
              <input className="admin-inp" maxLength={200} value={reason} onChange={e => setReason(e.target.value)} /></label>
            <div className="flex gap-2">
              <button type="button" className="admin-btn-sm" disabled={busy || reason.trim().length < 3} onClick={() => void run()}>Batalkan</button>
              <button type="button" className="admin-btn-sm" onClick={() => setOpen(false)}>Tutup</button>
            </div>
          </div>
        )}
      {error && <p role="alert" className="m-0 text-[12px] font-medium text-admin-danger">{error}</p>}
    </div>
  )
}
