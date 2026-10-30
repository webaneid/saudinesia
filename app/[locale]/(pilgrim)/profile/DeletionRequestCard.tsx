'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { ShieldAlert } from 'lucide-react'
import { DATE_NUMERIC, formatInstant } from '@/lib/time'

type DeletionRequest = { status: 'pending' | 'completed' | 'rejected' | 'withdrawn'; requestedAt: string; minWaitHours?: number } | null

export function DeletionRequestCard() {
  const [request, setRequest] = useState<DeletionRequest>(null)
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const r = await fetch('/api/v1/account/deletion-requests')
    const j = await r.json()
    setRequest(j.data ?? null)
  }
  useEffect(() => { load() }, [])

  async function call(method: 'POST' | 'DELETE') {
    setLoading(true); setError(null)
    try {
      const r = await fetch('/api/v1/account/deletion-requests', { method })
      const j = await r.json().catch(() => null)
      if (!r.ok) setError(j?.error ?? (r.status === 429 ? 'Terlalu sering mencoba. Coba lagi nanti.' : 'Gagal memproses. Coba lagi.'))
      await load()
      setConfirming(false)
    } finally {
      setLoading(false)
    }
  }
  const handleSubmit = () => call('POST')
  const handleWithdraw = () => call('DELETE')

  return (
    <div className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-muted-foreground" />
        <h2 className="font-semibold text-sm">Hapus Akun</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Sesuai UU Pelindungan Data Pribadi, Anda berhak mengajukan penghapusan akun dan data pribadi.
        Permintaan diperiksa tim kami lebih dulu dan paling cepat diproses 72 jam setelah pengajuan; Anda bisa membatalkannya selama itu. Profil, kontak, alamat, serta data dan dokumen jamaah dihapus permanen; catatan transaksi (kode dan jumlah) tetap disimpan tanpa identitas Anda sesuai kewajiban hukum/pajak. Booking yang masih berjalan atau refund yang belum tuntas harus selesai dulu.
      </p>

      {request?.status === 'pending' && (
        <div className="space-y-2">
          <p className="text-xs text-amber-600">
            Permintaan Anda menunggu sejak {formatInstant(request.requestedAt, DATE_NUMERIC)}. Kami juga mengirim email konfirmasi ke alamat akun Anda.
          </p>
          <Button variant="outline" size="sm" disabled={loading} onClick={handleWithdraw}>
            {loading ? 'Memproses...' : 'Batalkan Permintaan'}
          </Button>
        </div>
      )}
      {request?.status === 'withdrawn' && (
        <p className="text-xs text-muted-foreground">Permintaan hapus akun Anda telah dibatalkan.</p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {request?.status === 'completed' && (
        <p className="text-xs text-green-600">Permintaan hapus akun Anda telah selesai diproses.</p>
      )}
      {request?.status === 'rejected' && (
        <p className="text-xs text-destructive">Permintaan hapus akun sebelumnya ditolak. Hubungi kami untuk info lebih lanjut.</p>
      )}

      {!request || request.status === 'rejected' || request.status === 'withdrawn' ? (
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
