'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, MessageCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type Issued = { code: string; link: string; expiresAt: string }

const POLL_MS = 3000

// Verifikasi WhatsApp lewat pesan MASUK (ADR-0002): pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis; kita tidak mengirim apa pun.
// Verifikasi TIDAK menghalangi apa pun — tanpa verifikasi, notifikasi tetap dikirim lewat email.
export function WhatsappVerifyCard({ initialVerified, hasNumber }: { initialVerified: boolean; hasNumber: boolean }) {
  const t = useTranslations('shared.whatsapp')
  const [verified, setVerified] = useState(initialVerified)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [slow, setSlow] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!issued || verified) return
    const stopAt = Date.parse(issued.expiresAt)
    const slowTimer = setTimeout(() => setSlow(true), 90_000) // pesan tak kunjung terdeteksi → beri petunjuk
    timer.current = setInterval(async () => {
      if (Date.now() > stopAt) { if (timer.current) clearInterval(timer.current); setIssued(null); setError(t('expired')); return }
      try {
        const r = await fetch('/api/v1/auth/whatsapp/status')
        const j = await r.json()
        if (j.success && j.data?.verified) { setVerified(true); setIssued(null) }
      } catch { /* coba lagi pada putaran berikutnya */ }
    }, POLL_MS)
    return () => { clearTimeout(slowTimer); if (timer.current) clearInterval(timer.current) }
  }, [issued, verified])

  async function request() {
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/whatsapp/verification', { method: 'POST' })
      const j = await res.json()
      if (!j.success) { setError(j.error ?? t('requestFailed')); return }
      setIssued(j.data); setSlow(false)
    } catch {
      setError(t('network'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div id="verifikasi-whatsapp" className="rounded-xl border bg-card p-6 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">{t('title')}</h2>
        </div>
        {verified
          ? <Badge variant="success" className="text-xs"><CheckCircle2 className="mr-1 h-3 w-3" />{t('verified')}</Badge>
          : <Badge variant="warning" className="text-xs">{t('notVerified')}</Badge>}
      </div>

      {verified ? (
        <p className="text-sm text-muted-foreground">{t('verifiedText')}</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{t.rich('intro', { strong: c => <strong>{c}</strong> })}</p>
          {!hasNumber && <p className="text-xs text-muted-foreground">{t('saveFirst')}</p>}
          {issued && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
              <p>{t.rich('sendFrom', { strong: c => <strong>{c}</strong> })}</p>
              <p className="font-mono text-base font-bold tracking-widest">VERIF {issued.code}</p>
              <Button asChild size="sm"><a href={issued.link} target="_blank" rel="noopener noreferrer">{t('open')}</a></Button>
              <p className="text-xs text-muted-foreground">{t('auto')}</p>
              {slow && <p className="text-xs text-amber-700">{t.rich('slow', { strong: c => <strong>{c}</strong> })}</p>}
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!issued && <Button size="sm" onClick={request} disabled={loading || !hasNumber}>{loading ? t('requesting') : t('verify')}</Button>}
        </>
      )}
    </div>
  )
}
