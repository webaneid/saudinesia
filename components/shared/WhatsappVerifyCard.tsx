'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CheckCircle2, ExternalLink, Loader2, MessageCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyValue } from '@/components/shared/CopyValue'
import { useApiError } from '@/components/shared/useApiError'
import { formatE164 } from '@/lib/utils/phone'
import { formatInstant } from '@/lib/time'
import { cn } from '@/lib/utils'

type Issued = { code: string; link: string; expiresAt: string; businessNumber: string }

const POLL_MS = 3000
const SLOW_MS = 90_000

// Verifikasi WhatsApp lewat pesan MASUK (ADR-0002): pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor Saudinesia yang tertaut lewat scan;
// kita tidak mengirim apa pun. "Verifikasi Sekarang" langsung membuka WhatsApp dengan pesan siap kirim; salin nomor/kode untuk kirim manual.
// Verifikasi TIDAK menghalangi apa pun — tanpa verifikasi, notifikasi tetap dikirim lewat email.
export function WhatsappVerifyCard({ initialVerified, number, className }: { initialVerified: boolean; number: string; className?: string }) {
  const t = useTranslations('shared.whatsapp')
  const locale = useLocale()
  const errorText = useApiError()
  const [verified, setVerified] = useState(initialVerified)
  // undefined = belum diketahui; null = gateway tidak terhubung (verifikasi sedang tidak tersedia).
  const [business, setBusiness] = useState<string | null | undefined>(undefined)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [slow, setSlow] = useState(false)
  const own = formatE164(number)
  const b = (c: React.ReactNode) => <strong className="whitespace-nowrap font-semibold text-foreground">{c}</strong>

  useEffect(() => {
    if (initialVerified) return
    let alive = true
    fetch('/api/v1/auth/whatsapp/verification', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive && j?.success) setBusiness(typeof j.data?.businessNumber === 'string' ? j.data.businessNumber : null) })
      .catch(() => {})
    return () => { alive = false }
  }, [initialVerified])

  useEffect(() => {
    if (!issued || verified) return
    const stopAt = Date.parse(issued.expiresAt)
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS) // pesan tak kunjung terdeteksi → beri petunjuk
    const timer = setInterval(async () => {
      if (Date.now() > stopAt) { clearInterval(timer); setIssued(null); setError(t('expired')); return }
      try {
        const r = await fetch('/api/v1/auth/whatsapp/status')
        const j = await r.json()
        if (j.success && j.data?.verified) { setVerified(true); setIssued(null) }
      } catch { /* coba lagi pada putaran berikutnya */ }
    }, POLL_MS)
    return () => { clearTimeout(slowTimer); clearInterval(timer) }
  }, [issued, verified, t])

  async function start() {
    // Tab dibuka SEKARANG (masih dalam klik) supaya tidak diblokir; alamatnya diisi sesudah kode terbit. Diblokir → tombol "Buka WhatsApp" tetap ada.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/whatsapp/verification', { method: 'POST' })
      const j = await res.json()
      if (!j.success) {
        tab?.close()
        if (j.meta?.code === 'whatsappUnavailable') { setBusiness(null); return }
        setError(errorText(j, t('requestFailed')))
        return
      }
      const next = j.data as Issued
      setIssued(next); setBusiness(next.businessNumber); setSlow(false)
      if (tab && !tab.closed) tab.location.href = next.link
    } catch {
      tab?.close()
      setError(t('network'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="verifikasi-whatsapp" aria-label={t('title')} className={cn('scroll-mt-24 rounded-2xl border bg-card p-5 sm:p-6', !verified && 'border-amber-300 bg-amber-50/60', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5 text-green-600" aria-hidden /> {t('title')}</h2>
        {verified
          ? <Badge variant="success"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />{t('verified')}</Badge>
          : <Badge variant="warning">{t('notVerified')}</Badge>}
      </div>

      {verified ? (
        <p className="mt-3 text-sm text-muted-foreground">{t.rich('verifiedText', { number: own, b })}</p>
      ) : !number ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('saveFirst')}</p>
      ) : business === null ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('unavailable')}</p>
      ) : issued ? (
        <div className="mt-4 space-y-4">
          <ol className="space-y-2 text-sm text-muted-foreground">
            {[t.rich('step1', { number: own, b }), t('step2'), t('step3')].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-semibold text-white">{i + 1}</span>
                <span className="pt-0.5">{step}</span>
              </li>
            ))}
          </ol>
          <p role="status" className="flex items-center gap-2 text-sm font-medium"><Loader2 className="h-4 w-4 animate-spin text-green-600" aria-hidden /> {t('waiting')}</p>
          <Button asChild className="w-full bg-green-600 text-white hover:bg-green-700">
            <a href={issued.link} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden /> {t('openAgain')}</a>
          </Button>
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <p className="text-sm font-medium">{t('manual')}</p>
            <CopyValue label={t('manualNumber')} display={formatE164(issued.businessNumber)} value={`+${issued.businessNumber}`}
              copyLabel={t('copy')} copiedLabel={t('copied')} ariaLabel={t('copyNumber')} failedLabel={t('copyFailed')} />
            <CopyValue label={t('manualMessage')} display={`VERIF ${issued.code}`}
              copyLabel={t('copy')} copiedLabel={t('copied')} ariaLabel={t('copyMessage')} failedLabel={t('copyFailed')} />
          </div>
          <p className="text-xs text-muted-foreground">{t('expires', { time: formatInstant(issued.expiresAt, { hour: '2-digit', minute: '2-digit' }, undefined, locale === 'en' ? 'en' : 'id') })}</p>
          {slow && <p className="text-xs text-amber-800">{t.rich('slow', { number: own, b })}</p>}
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-muted-foreground">{t.rich('intro', { number: own, b, i: c => <em>{c}</em> })}</p>
          <Button onClick={start} disabled={loading} className="w-full bg-green-600 text-white hover:bg-green-700">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageCircle className="h-4 w-4" aria-hidden />} {loading ? t('requesting') : t('verify')}
          </Button>
          {business && <p className="text-xs text-muted-foreground">{t.rich('target', { number: formatE164(business), b })}</p>}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
    </section>
  )
}
