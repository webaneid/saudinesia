'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, KeyRound, Link2, Link2Off, QrCode, RefreshCw, Send } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { Card } from '@/components/admin/ui/Card'
import { Modal } from '@/components/admin/ui/Modal'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import type { WhatsappAction, WhatsappPanelStatus } from '@/lib/validators/whatsapp'

const POLL_MS = 3000
/** QR GOWA berlaku ±30 dtk; dimuat ulang otomatis paling banyak sekian kali, lalu admin menekan "Muat ulang QR" sendiri. */
const MAX_AUTO_REFRESH = 6

type Json = { success: boolean; data?: unknown; error?: string }
type Login = { mode: 'qr'; qr: string | null; left: number; refreshes: number } | { mode: 'code'; code: string | null }

async function act(action: WhatsappAction): Promise<Json> {
  const r = await fetch('/api/v1/admin/system/whatsapp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
  return (await r.json().catch(() => ({ success: false, error: `Galat server (HTTP ${r.status})` }))) as Json
}

function stateOf(s: WhatsappPanelStatus): { tone: BadgeTone; label: string; text: string } {
  if (!s.configured) return { tone: 'warning', label: 'Belum diatur', text: 'WA_GATEWAY_URL belum diisi di server. WhatsApp dilewati; notifikasi tetap lewat email.' }
  if (!s.gateway.reachable) return { tone: 'danger', label: 'Tidak terjangkau', text: 'Gateway tidak menjawab. Periksa layanan gowa di server. Notifikasi tetap lewat email.' }
  if (s.gateway.unauthorized) return { tone: 'danger', label: 'Kredensial salah', text: 'Gateway menolak WA_GATEWAY_USER/WA_GATEWAY_PASSWORD. Samakan dengan pengaturan layanan gowa.' }
  if (s.gateway.connected === true) return { tone: 'ok', label: 'Terhubung', text: 'Perangkat WhatsApp masuk. Notifikasi WhatsApp dikirim ke nomor jamaah yang terverifikasi.' }
  if (s.gateway.connected === false) return { tone: 'warning', label: 'Terputus', text: 'Belum ada nomor yang masuk. Hubungkan nomor bisnis dengan scan QR atau kode pasangan.' }
  return { tone: 'neutral', label: 'Tidak diketahui', text: 'Gateway menjawab dengan bentuk yang tak dikenal.' }
}

export function WhatsappPanel({ initial }: { initial: WhatsappPanelStatus }) {
  const [status, setStatus] = useState(initial)
  const [busy, setBusy] = useState<WhatsappAction | 'refresh' | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [login, setLogin] = useState<Login | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const { ask, dialog } = useConfirm()
  const loginRef = useRef(login)
  loginRef.current = login

  const refresh = useCallback(async (): Promise<WhatsappPanelStatus | null> => {
    const r = await fetch('/api/v1/admin/system/whatsapp', { cache: 'no-store' })
    const j = (await r.json().catch(() => null)) as Json | null
    if (!j?.success || !j.data) return null
    const next = j.data as WhatsappPanelStatus
    setStatus(next)
    return next
  }, [])

  const closeLogin = useCallback(() => { setLogin(null); setLoginError(null) }, [])

  const loadQr = useCallback(async (refreshes: number) => {
    setLoginError(null)
    setLogin({ mode: 'qr', qr: null, left: 0, refreshes })
    const j = await act('qr')
    if (!loginRef.current) return
    const d = j.data as { qr: string; durationSec: number } | undefined
    if (j.success && d) setLogin({ mode: 'qr', qr: d.qr, left: d.durationSec, refreshes })
    else {
      setLoginError(j.error ?? 'QR tidak dapat dimuat.')
      if (/sudah terhubung/i.test(j.error ?? '')) { await refresh(); closeLogin() }
    }
  }, [refresh, closeLogin])

  const loadCode = useCallback(async () => {
    setLoginError(null)
    setLogin({ mode: 'code', code: null })
    const j = await act('pairCode')
    if (!loginRef.current) return
    const d = j.data as { code: string } | undefined
    if (j.success && d) setLogin({ mode: 'code', code: d.code })
    else setLoginError(j.error ?? 'Kode pasangan tidak dapat dibuat.')
  }, [])

  const open = login !== null
  // Selama jendela masuk terbuka: periksa status tiap 3 dtk; terhubung → tutup dan tampilkan hasil.
  useEffect(() => {
    if (!open) return
    const t = setInterval(async () => {
      const s = await refresh()
      if (s?.gateway.connected) { closeLogin(); setMessage({ tone: 'ok', text: 'WhatsApp terhubung.' }) }
    }, POLL_MS)
    return () => clearInterval(t)
  }, [open, refresh, closeLogin])

  // Hitung mundur QR; habis → muat QR baru (dibatasi).
  const qrLeft = login?.mode === 'qr' && login.qr ? login.left : null
  useEffect(() => {
    if (qrLeft === null) return
    const t = setTimeout(() => {
      const cur = loginRef.current
      if (cur?.mode !== 'qr' || !cur.qr) return
      if (cur.left > 1) setLogin({ ...cur, left: cur.left - 1 })
      else if (cur.refreshes < MAX_AUTO_REFRESH) void loadQr(cur.refreshes + 1)
      else setLogin({ ...cur, qr: null, left: 0 })
    }, 1000)
    return () => clearTimeout(t)
  }, [qrLeft, loadQr])

  async function run(action: 'disconnect' | 'reconnect' | 'test') {
    if (action === 'disconnect') {
      const yes = await ask({
        title: 'Putuskan WhatsApp?',
        body: 'Nomor bisnis dikeluarkan dari gateway. Notifikasi WhatsApp berhenti sampai nomor di-scan lagi; email tetap terkirim.',
        confirmLabel: 'Ya, putuskan', tone: 'danger',
      })
      if (!yes) return
    }
    setBusy(action)
    setMessage(null)
    const j = await act(action)
    setBusy(null)
    if (!j.success) { setMessage({ tone: 'error', text: j.error ?? 'Gagal.' }); return }
    if (action === 'test') {
      const d = j.data as { status: string; detail?: string }
      setMessage(d.status === 'sent' ? { tone: 'ok', text: 'Pesan uji terkirim ke nomor WhatsApp Anda.' } : { tone: 'error', text: `Pesan uji tidak terkirim: ${d.detail ?? d.status}` })
      return
    }
    setStatus(j.data as WhatsappPanelStatus)
    setMessage({ tone: 'ok', text: action === 'disconnect' ? 'WhatsApp diputuskan.' : 'Perintah sambung ulang dikirim.' })
  }

  async function manualRefresh() {
    setBusy('refresh')
    const s = await refresh()
    setBusy(null)
    if (!s) setMessage({ tone: 'error', text: 'Status tidak dapat dibaca.' })
  }

  const st = stateOf(status)
  const usable = status.configured && status.gateway.reachable && !status.gateway.unauthorized
  const connected = status.gateway.connected === true

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="m-0 text-base font-semibold text-admin-ink">Status gateway</h2>
            <p className="m-0 text-sm text-admin-muted">{st.text}</p>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-admin-muted">Nomor tertaut</dt>
            <dd className="m-0 font-medium text-admin-ink">{status.gateway.phone ? `+${status.gateway.phone}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-admin-muted">Nomor bisnis (yang harus di-scan)</dt>
            <dd className="m-0 font-medium text-admin-ink">{status.businessNumber ? `+${status.businessNumber}` : 'Belum diisi (NEXT_PUBLIC_BUSINESS_WA)'}</dd>
          </div>
          <div>
            <dt className="text-xs text-admin-muted">Verifikasi nomor jamaah (webhook)</dt>
            <dd className="m-0 font-medium text-admin-ink">{status.webhookSecretSet ? 'Aktif' : 'Mati — WHATSAPP_WEBHOOK_SECRET belum kuat'}</dd>
          </div>
        </dl>

        {status.numberMismatch && (
          <p role="alert" className="m-0 flex items-start gap-2 rounded-xl border border-admin-warning/40 bg-admin-warning/10 p-3 text-sm text-admin-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-admin-warning" aria-hidden />
            Nomor yang tertaut berbeda dengan nomor bisnis. Jamaah mengirim kode verifikasi ke nomor bisnis, jadi verifikasi tidak akan sampai. Putuskan, lalu scan dengan nomor bisnis.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {!connected && (
            <>
              <Button size="sm" onClick={() => void loadQr(0)} disabled={!usable || busy !== null}><QrCode className="size-4" aria-hidden /> Hubungkan (scan QR)</Button>
              <Button size="sm" variant="outline" onClick={() => void loadCode()} disabled={!usable || !status.businessNumber || busy !== null}><KeyRound className="size-4" aria-hidden /> Masuk dengan kode</Button>
              <Button size="sm" variant="outline" onClick={() => void run('reconnect')} loading={busy === 'reconnect'} disabled={!usable || busy !== null}><Link2 className="size-4" aria-hidden /> Sambung ulang</Button>
            </>
          )}
          {connected && (
            <>
              <Button size="sm" onClick={() => void run('test')} loading={busy === 'test'} disabled={busy !== null}><Send className="size-4" aria-hidden /> Kirim pesan uji</Button>
              <Button size="sm" variant="danger" onClick={() => void run('disconnect')} loading={busy === 'disconnect'} disabled={busy !== null}><Link2Off className="size-4" aria-hidden /> Putuskan</Button>
            </>
          )}
          <Button size="sm" variant="ghost" onClick={() => void manualRefresh()} loading={busy === 'refresh'} disabled={busy !== null}><RefreshCw className="size-4" aria-hidden /> Periksa status</Button>
        </div>
        {connected && <p className="m-0 text-xs text-admin-muted">Pesan uji dikirim ke nomor WhatsApp terverifikasi milik akun Anda sendiri.</p>}
        {message && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`m-0 text-sm font-medium ${message.tone === 'error' ? 'text-admin-danger' : 'text-admin-ok'}`}>{message.text}</p>}
      </Card>

      <Modal open={open} title={login?.mode === 'code' ? 'Masuk dengan kode pasangan' : 'Scan QR WhatsApp'} onClose={closeLogin}>
        <div className="space-y-4 text-sm">
          {login?.mode === 'qr' && (
            <>
              <ol className="m-0 list-decimal space-y-1 pl-5 text-admin-muted">
                <li>Buka WhatsApp di ponsel nomor bisnis{status.businessNumber ? ` (+${status.businessNumber})` : ''}.</li>
                <li>Ketuk Perangkat tertaut, lalu Tautkan perangkat.</li>
                <li>Arahkan kamera ke QR di bawah.</li>
              </ol>
              <div className="flex flex-col items-center gap-2">
                {login.qr
                  // eslint-disable-next-line @next/next/no-img-element -- PNG QR diambil server kita dari GOWA internal (data URI); loader MinIO next/image tak berlaku
                  ? <img src={login.qr} alt="QR masuk WhatsApp" width={256} height={256} className="size-64 rounded-xl border border-admin-line" />
                  : <div className="flex size-64 items-center justify-center rounded-xl border border-dashed border-admin-line text-admin-muted">{loginError ? 'QR tidak tersedia' : login.left === 0 && login.refreshes >= MAX_AUTO_REFRESH ? 'QR kedaluwarsa' : 'Memuat QR…'}</div>}
                {login.qr && <p className="m-0 text-xs text-admin-muted">QR berganti dalam {login.left} detik</p>}
                {!login.qr && login.refreshes >= MAX_AUTO_REFRESH && <Button size="sm" variant="outline" onClick={() => void loadQr(0)}><RefreshCw className="size-4" aria-hidden /> Muat ulang QR</Button>}
              </div>
            </>
          )}
          {login?.mode === 'code' && (
            <>
              <ol className="m-0 list-decimal space-y-1 pl-5 text-admin-muted">
                <li>Buka WhatsApp di ponsel nomor bisnis{status.businessNumber ? ` (+${status.businessNumber})` : ''}.</li>
                <li>Ketuk Perangkat tertaut, Tautkan perangkat, lalu Tautkan dengan nomor telepon.</li>
                <li>Masukkan kode di bawah.</li>
              </ol>
              <p className="m-0 text-center font-mono text-3xl font-bold tracking-widest text-admin-ink">{login.code ?? (loginError ? '—' : 'Membuat kode…')}</p>
              {!login.code && loginError && <div className="flex justify-center"><Button size="sm" variant="outline" onClick={() => void loadCode()}><RefreshCw className="size-4" aria-hidden /> Coba lagi</Button></div>}
            </>
          )}
          {loginError && <p role="alert" className="m-0 text-sm font-medium text-admin-danger">{loginError}</p>}
          <p className="m-0 text-xs text-admin-muted">Jendela ini tertutup sendiri begitu WhatsApp terhubung.</p>
        </div>
      </Modal>
      {dialog}
    </div>
  )
}
