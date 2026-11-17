'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CreditCard, ExternalLink, RefreshCw, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { useApiError } from '@/components/shared/useApiError'
import { gatewayFee, type FeeRule } from '@/lib/payments/feeCalc'
import type { GatewayView } from '@/lib/payments/gatewayView'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'

export type OnlineChannel = { id: string; group: string; name: string; groupName: string }

type Props = {
  bookingId: string
  locale: string
  channels: OnlineChannel[]
  fees: FeeRule[]
  balance: number
  minClaim: number
  /** Pembayaran online yang sedang menunggu (satu per booking, K9-3). */
  active: GatewayView | null
}

// Bayar online lewat iPaymu (Fase 9): kanal + nominal dipilih di sini, biaya layanan dipratinjau (server menghitung ulang), nomor VA / QR / tautan
// tampil di halaman kita. Status lunas dikonfirmasi otomatis oleh server (callback + "Periksa status").
export function OnlinePayment({ bookingId, locale, channels, fees, balance, minClaim, active }: Props) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.payment.online')
  const errorText = useApiError()
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState('')
  const [amount, setAmount] = useState(String(Math.floor(balance)))
  const [view, setView] = useState<GatewayView | null>(active)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const amountNum = Number(amount)
  const amountOk = /^\d{1,10}$/.test(amount) && amountNum >= Math.ceil(minClaim) && amountNum <= balance
  const picked = channels.find(c => c.id === channel)
  const fee = picked && amountOk ? gatewayFee(amountNum, picked.group, fees) : 0

  async function call(url: string, init: RequestInit, fallback: string): Promise<{ ok: boolean; data?: GatewayView }> {
    setBusy(true); setError(null); setInfo(null)
    try {
      const res = await fetch(url, init)
      const json = await res.json().catch(() => null) as { data?: GatewayView; error?: string } | null
      if (!res.ok) { setError(errorText(json, fallback)); return { ok: false } }
      return { ok: true, data: json?.data }
    } catch { setError(t('network')); return { ok: false } } finally { setBusy(false) }
  }

  async function create() {
    if (!picked || !amountOk || busy) return
    const r = await call(`/api/v1/bookings/${bookingId}/payment/gateway`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: amountNum, channel: picked.id }) }, t('failed'))
    if (r.ok && r.data) { setView(r.data); router.refresh() }
  }
  async function check() {
    if (!view || busy) return
    const r = await call(`/api/v1/bookings/${bookingId}/payment/gateway/${view.id}/check`, { method: 'POST' }, t('checkFailed'))
    if (!r.ok || !r.data) return
    setView(r.data)
    if (r.data.status === 'confirmed') { setInfo(t('paid')); router.refresh() }
    else if (r.data.status === 'expired') { setInfo(t('expired')); router.refresh() }
    else setInfo(t('stillWaiting'))
  }
  async function cancel() {
    if (!view || busy) return
    const r = await call(`/api/v1/bookings/${bookingId}/payment/gateway/${view.id}`, { method: 'DELETE' }, t('cancelFailed'))
    if (r.ok) { setView(null); router.refresh() }
  }

  if (view && view.status === 'awaiting') {
    return (
      <div className="space-y-3 rounded-lg border bg-white p-4">
        <p className="flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" aria-hidden /> {t('activeTitle', { channel: view.channelName })}</p>
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t('amountLabel')}</span><span>{formatRupiah(view.amount)}</span>
          {view.fee > 0 && <><span className="text-muted-foreground">{t('feeLabel')}</span><span>{formatRupiah(view.fee)}</span></>}
          <span className="text-muted-foreground">{t('totalLabel')}</span><span className="font-bold">{formatRupiah(view.total)}</span>
          {view.expiresAt && <><span className="text-muted-foreground">{t('expiresLabel')}</span><span>{formatInstant(view.expiresAt, DATETIME_MEDIUM, undefined, locale)}</span></>}
        </div>
        {view.kind === 'code' && view.payCode && (
          <div className="rounded-md bg-muted p-3 text-center">
            <p className="text-xs text-muted-foreground">{t('codeLabel')}</p>
            <p className="select-all break-all font-mono text-xl font-bold tracking-wider">{view.payCode}</p>
          </div>
        )}
        {view.kind === 'qr' && view.qrSvg && (
          <div className="flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- SVG QR dibuat server kita sendiri (data URI); loader MinIO next/image tak berlaku */}
            <img src={`data:image/svg+xml;utf8,${encodeURIComponent(view.qrSvg)}`} alt={t('qrAlt')} width={280} height={280} className="h-64 w-64" />
            <p className="text-xs text-muted-foreground">{t('qrHint')}</p>
          </div>
        )}
        {view.kind === 'url' && view.payUrl && (
          <a href={view.payUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-primary underline">
            <ExternalLink className="h-4 w-4" aria-hidden /> {t('openApp')}
          </a>
        )}
        <p className="text-xs text-muted-foreground">{t('autoHint')}</p>
        {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
        {info && <p role="status" className="text-sm text-muted-foreground">{info}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={check} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" aria-hidden /> {t('check')}</Button>
          <Button type="button" variant="outline" onClick={cancel} disabled={busy}><XCircle className="mr-2 h-4 w-4" aria-hidden /> {t('cancel')}</Button>
        </div>
      </div>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full bg-white" onClick={() => setOpen(true)}>
        <CreditCard className="mr-2 h-4 w-4" aria-hidden /> {t('open')}
      </Button>
    )
  }

  return (
    <div className="space-y-4 rounded-lg bg-white/70 p-4">
      <p className="font-semibold">{t('formTitle')}</p>
      <div className="space-y-2">
        <Label>{t('channel')}</Label>
        <ChoiceSelect ariaLabel={t('channel')} value={channel} onChange={setChannel} placeholder={t('channelPlaceholder')} clearable={false}
          options={channels.map(c => ({ id: c.id, label: c.name, hint: c.groupName }))} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="online-amount">{t('amount')}</Label>
        <Input id="online-amount" inputMode="numeric" className="bg-white" value={amount} onChange={e => { setError(null); setAmount(e.target.value.replace(/\D/g, '').slice(0, 10)) }} />
        <p className="text-xs text-muted-foreground">{t('amountRange', { min: formatRupiah(Math.ceil(minClaim)), max: formatRupiah(balance) })}</p>
      </div>
      {picked && amountOk && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">{t('amountLabel')}</span><span>{formatRupiah(amountNum)}</span>
          <span className="text-muted-foreground">{t('feeLabel')}</span><span>{fee > 0 ? formatRupiah(fee) : t('noFee')}</span>
          <span className="text-muted-foreground">{t('totalLabel')}</span><span className="font-bold">{formatRupiah(amountNum + fee)}</span>
        </div>
      )}
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="button" className="w-full" onClick={create} disabled={!picked || !amountOk || busy}>{busy ? t('creating') : t('submit')}</Button>
    </div>
  )
}
