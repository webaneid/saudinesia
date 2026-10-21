'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ShieldAlert } from 'lucide-react'

type DeletionRequest = { status: 'pending' | 'completed' | 'rejected'; requestedAt: string } | null

export function DeletionRequestCard() {
  const [request, setRequest] = useState<DeletionRequest>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  async function load() {
    const r = await fetch('/api/v1/account/deletion-requests')
    const j = await r.json()
    setRequest(j.data ?? null)
  }
  useEffect(() => { load() }, [])

  async function handleSubmit() {
    setLoading(true)
    await fetch('/api/v1/account/deletion-requests', { method: 'POST' })
    await load()
    setConfirming(false)
    setLoading(false)
  }

  return (
    <div className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Hapus Akun</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Sesuai UU Pelindungan Data Pribadi, Anda berhak mengajukan penghapusan akun dan data pribadi.
        Permintaan diproses manual oleh tim kami (riwayat transaksi tetap disimpan sesuai kewajiban hukum/pajak).
      </p>

      {request?.status === 'pending' && (
        <p className="text-xs text-amber-600">
          Permintaan Anda sedang diproses sejak {new Date(request.requestedAt).toLocaleDateString('id-ID')}.
        </p>
      )}
      {request?.status === 'completed' && (
        <p className="text-xs text-green-600">Permintaan hapus akun Anda telah selesai diproses.</p>
      )}
      {request?.status === 'rejected' && (
        <p className="text-xs text-destructive">Permintaan hapus akun sebelumnya ditolak. Hubungi kami untuk info lebih lanjut.</p>
      )}

      {!request || request.status === 'rejected' ? (
        confirming ? (
          <div className="flex gap-2">
            <Button variant="destructive" size="sm" disabled={loading} onClick={handleSubmit}>
              {loading ? 'Mengirim...' : 'Ya, Ajukan'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>Batal</Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>Ajukan Hapus Akun</Button>
        )
      ) : null}
    </div>
  )
}
