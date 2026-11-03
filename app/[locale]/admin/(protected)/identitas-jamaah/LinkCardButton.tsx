'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Link2 } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'

// Tautkan kartu tanpa kunci (bayi tanpa NIK) ke identitas yang disarankan — dikonfirmasi; galat server ditampilkan.
export function LinkCardButton({ cardId, identityId, label }: { cardId: string; identityId: string; label: string }) {
  const router = useRouter()
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function link() {
    if (!(await ask({ title: 'Tautkan kartu ke identitas ini?', body: 'Pastikan orangnya sama (nama, tanggal lahir, orang tua). Tautan bisa dilepas lagi dari halaman identitas.', confirmLabel: 'Tautkan', tone: 'primary' }))) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/identities/unmatched/${cardId}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identityId }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error ?? 'Gagal menautkan.'); return }
      router.refresh()
    } catch { setError('Tidak dapat menghubungi server.') } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={link} aria-label={label} className="admin-btn-sm inline-flex items-center gap-1 border border-admin-line bg-white text-admin-ink hover:bg-admin-spot disabled:opacity-50">
        <Link2 className="size-3.5" /> Tautkan
      </button>
      {error && <span role="alert" className="text-admin-danger">{error}</span>}
      {dialog}
    </>
  )
}
