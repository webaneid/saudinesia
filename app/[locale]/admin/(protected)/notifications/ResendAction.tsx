'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send } from 'lucide-react'
import { ActionButton } from '@/components/shared/data-table/RowActions'
import { ConfirmDialog } from '@/components/admin/ui/ConfirmDialog'

// Kirim ulang satu baris log (docs/arsitektur-notifikasi.md §14). Pesan disusun ulang dari data booking TERKINI dan dikirim lewat email + WhatsApp;
// hasil per kanal ditampilkan supaya admin tahu bila kanal dilewati (mis. nomor belum terverifikasi). Galat server tampil apa adanya.

type Channel = { channel: 'whatsapp' | 'email'; status: 'sent' | 'failed' | 'skipped' | 'duplicate' }
const STATUS: Record<Channel['status'], string> = { sent: 'terkirim', failed: 'gagal', skipped: 'dilewati', duplicate: 'sudah terkirim' }
const NAME: Record<Channel['channel'], string> = { whatsapp: 'WhatsApp', email: 'Email' }

export function ResendAction({ logId, code }: { logId: string; code: string | null }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  async function send() {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/notifications/${logId}/resend`, { method: 'POST' })
      const j = await res.json().catch(() => null) as { success?: boolean; error?: string; data?: { channels?: Channel[] } } | null
      if (!res.ok || !j?.success) { setError(j?.error ?? 'Gagal mengirim ulang notifikasi.'); return }
      const channels = j.data?.channels ?? []
      setResult(channels.length ? channels.map(c => `${NAME[c.channel]}: ${STATUS[c.status]}`).join(' · ') : 'Tidak ada kanal yang bisa dituju pelanggan ini.')
      router.refresh()
    } catch {
      setError('Tidak dapat menghubungi server.')
    } finally { setBusy(false) }
  }

  const close = () => { setOpen(false); setError(null); setResult(null) }
  return (
    <>
      <ActionButton icon={Send} label="Kirim ulang" onClick={() => setOpen(true)} />
      <ConfirmDialog open={open} title="Kirim ulang notifikasi?" confirmLabel="Kirim ulang" busy={busy} error={error} result={result} onConfirm={send} onClose={close}>
        Pesan disusun ulang dari data {code ? <>booking <strong>{code}</strong></> : 'booking'} saat ini (tagihan, jatuh tempo, tanggal berangkat terkini) lalu dikirim lewat email dan WhatsApp terverifikasi.
      </ConfirmDialog>
    </>
  )
}
