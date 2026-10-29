'use client'

import { useState } from 'react'
import { MailPlus } from 'lucide-react'
import { Button } from '@/components/admin/ui/Button'

// Kirim (ulang) undangan aktivasi untuk pelanggan yang belum diaktifkan (docs/arsitektur-pelanggan.md §6). Hasil server ditampilkan apa adanya.
const RESULT_TEXT: Record<string, { text: string; error: boolean }> = {
  sent: { text: 'Undangan terkirim. Tautan sebelumnya tidak berlaku lagi.', error: false },
  skipped: { text: 'Undangan dibuat tetapi email tidak terkirim (layanan email belum dikonfigurasi). Coba lagi nanti.', error: true },
  failed: { text: 'Email undangan gagal dikirim. Coba lagi nanti.', error: true },
}

export function ResendInviteButton({ customerId }: { customerId: string }) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  async function send() {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/customers/${customerId}/invite`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setNotice({ text: json?.error ?? 'Undangan gagal dikirim.', error: true }); return }
      setNotice(RESULT_TEXT[String(json?.data?.invite)] ?? { text: 'Selesai.', error: false })
    } catch {
      setNotice({ text: 'Tidak dapat menghubungi server.', error: true })
    } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" onClick={send} loading={busy}><MailPlus className="size-4" /> Kirim undangan aktivasi</Button>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={`m-0 text-[12px] font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ok'}`}>{notice.text}</p>}
    </div>
  )
}
