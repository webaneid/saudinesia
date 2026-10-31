'use client'

import { useState } from 'react'
import { Link2, Link2Off, Send } from 'lucide-react'
import { useConfirm } from '@/components/admin/ui/useConfirm'

// Tautan invoice publik (docs/arsitektur-booking-engine-v2.md §10.4 6c): salin (untuk dikirim sendiri — mis. pelanggan yang belum mengaktifkan akun tidak menerima email),
// kirim ulang notifikasi, dan cabut (semua tautan lama mati; tautan baru berlaku). Setiap respons diperiksa dan galatnya ditampilkan.
export function InvoiceLinkActions({ bookingId }: { bookingId: string }) {
  const { ask, dialog } = useConfirm()
  const [busy, setBusy] = useState<'copy' | 'send' | 'revoke' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const base = `/api/v1/admin/bookings/${bookingId}/invoice-link`

  async function run(kind: 'copy' | 'send' | 'revoke', fn: () => Promise<string>) {
    setBusy(kind); setMsg(null)
    try { setMsg({ ok: true, text: await fn() }) } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Gagal' }) } finally { setBusy(null) }
  }
  const call = async (path: string, method: 'GET' | 'POST') => {
    const res = await fetch(`${base}${path}`, { method })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error ?? 'Permintaan gagal')
    return json.data
  }

  const copy = () => run('copy', async () => {
    const d = await call('', 'GET') as { url: string; absolute: boolean }
    const url = d.absolute ? d.url : `${window.location.origin}${d.url}`
    try {
      await navigator.clipboard.writeText(url)
      setShown(null)
      return 'Tautan invoice disalin.'
    } catch {
      // Peramban menolak akses clipboard (mis. bukan HTTPS / izin ditolak): tampilkan tautannya untuk disalin manual.
      setShown(url)
      return 'Salin tautan di bawah ini secara manual.'
    }
  })
  const send = async () => {
    if (!(await ask({ title: 'Kirim ulang invoice ke pelanggan?', body: 'Email (alamat terverifikasi) dan WhatsApp (nomor terverifikasi) berisi tautan invoice terkini.', confirmLabel: 'Kirim', tone: 'primary' }))) return
    await run('send', async () => {
      const d = await call('/send', 'POST') as { channels: Array<{ channel: string; status: string }> }
      const sent = d.channels.filter(c => c.status === 'sent').map(c => (c.channel === 'email' ? 'email' : 'WhatsApp'))
      if (sent.length === 0) throw new Error('Tidak ada kanal yang terkirim (email/WhatsApp pelanggan belum terverifikasi atau gateway mati) — salin tautan dan kirim sendiri.')
      return `Invoice dikirim ulang lewat ${sent.join(' dan ')}.`
    })
  }
  const revoke = async () => {
    if (!(await ask({ title: 'Cabut tautan invoice?', body: 'Semua tautan lama berhenti berfungsi. Tautan baru langsung berlaku — salin atau kirim ulang ke pelanggan.', confirmLabel: 'Cabut tautan' }))) return
    await run('revoke', async () => { await call('/revoke', 'POST'); setShown(null); return 'Tautan lama dicabut. Salin tautan baru bila perlu.' })
  }

  const btn = 'inline-flex items-center gap-1 rounded-md border border-admin-line px-2 py-1 text-[11px] font-medium text-admin-ink/80 hover:bg-white hover:text-admin-ink disabled:opacity-50'
  return (
    <div className="space-y-1.5 border-t border-admin-line pt-2">
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={btn} onClick={copy} disabled={busy !== null}><Link2 className="size-3.5" /> {busy === 'copy' ? 'Menyalin…' : 'Salin tautan'}</button>
        <button type="button" className={btn} onClick={send} disabled={busy !== null}><Send className="size-3.5" /> {busy === 'send' ? 'Mengirim…' : 'Kirim ulang invoice'}</button>
        <button type="button" className={btn} onClick={revoke} disabled={busy !== null}><Link2Off className="size-3.5" /> {busy === 'revoke' ? 'Mencabut…' : 'Cabut tautan'}</button>
      </div>
      {shown && <input readOnly aria-label="Tautan invoice" className="admin-inp w-full font-mono text-[11px]" value={shown} onFocus={e => e.currentTarget.select()} />}
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`m-0 text-[11px] ${msg.ok ? 'text-admin-ok' : 'text-admin-danger'}`}>{msg.text}</p>}
      {dialog}
    </div>
  )
}
