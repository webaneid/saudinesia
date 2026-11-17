'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard, RefreshCw } from 'lucide-react'
import { formatRupiah } from '@/lib/utils'

export type GatewayPaymentRow = {
  id: string; status: string; channelName: string; amount: number; fee: number; mdr: number | null
  /** Sudah diformat di server (zona aplikasi). */
  createdAt: string; paidAt: string | null; expiresAt: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  awaiting: { label: 'Menunggu dibayar', cls: 'admin-badge-amber' },
  confirmed: { label: 'Lunas (otomatis)', cls: 'admin-badge-green' },
  expired: { label: 'Kedaluwarsa', cls: 'admin-badge-gray' },
}

// Pembayaran online iPaymu (Fase 9) di detail booking admin: tak ada verifikasi manual — status hanya dari iPaymu ("Periksa status" = /transaction).
export function GatewayPaymentsBox({ rows }: { rows: GatewayPaymentRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  if (rows.length === 0) return null

  async function check(id: string) {
    setBusy(id); setMsg(null)
    try {
      const res = await fetch(`/api/v1/admin/payments/${id}/check`, { method: 'POST' })
      const json = await res.json().catch(() => null) as { data?: { state: string }; error?: string } | null
      if (!res.ok) { setMsg({ ok: false, text: json?.error ?? 'Status gagal diperiksa' }); return }
      const state = json?.data?.state
      setMsg({ ok: true, text: state === 'confirmed' ? 'Pembayaran lunas — dikonfirmasi otomatis.' : state === 'expired' ? 'Pembayaran kedaluwarsa.' : state === 'mismatch' ? 'Nominal di iPaymu tidak cocok — periksa dasbor iPaymu.' : 'Belum ada pembayaran masuk.' })
      router.refresh()
    } catch { setMsg({ ok: false, text: 'Tidak dapat menghubungi server' }) } finally { setBusy(null) }
  }

  return (
    <div className="admin-form-panel space-y-3">
      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-admin-ink"><CreditCard className="h-4 w-4" aria-hidden /> Pembayaran online (iPaymu)</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {rows.map(r => {
          const s = STATUS[r.status] ?? { label: r.status, cls: 'admin-badge-gray' }
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-admin-line pt-2 text-sm">
              <div className="min-w-0">
                <p className="m-0 font-medium text-admin-ink">{r.channelName} · {formatRupiah(r.amount)}{r.fee > 0 ? ` + biaya ${formatRupiah(r.fee)}` : ''}</p>
                <p className="m-0 text-[11px] text-admin-muted">
                  Dibuat {r.createdAt}{r.paidAt ? ` · dibayar ${r.paidAt}` : r.expiresAt ? ` · batas ${r.expiresAt}` : ''}{r.mdr !== null ? ` · MDR ${formatRupiah(r.mdr)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={s.cls}>{s.label}</span>
                {r.status !== 'confirmed' && (
                  <button type="button" className="admin-btn-sm inline-flex items-center gap-1" onClick={() => check(r.id)} disabled={busy !== null} aria-label="Periksa status ke iPaymu">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {busy === r.id ? 'Memeriksa…' : 'Periksa status'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`m-0 text-xs ${msg.ok ? 'text-admin-ok' : 'text-admin-danger'}`}>{msg.text}</p>}
    </div>
  )
}
