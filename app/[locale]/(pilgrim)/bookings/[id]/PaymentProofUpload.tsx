'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { UploadCloud } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DateTimeField } from '@/components/shared/DateTimeField'
import { useApiError } from '@/components/shared/useApiError'
import { formatRupiah } from '@/lib/utils'

export type PayToOption = { bankName: string; accountNumber: string; accountHolder: string }

type Props = {
  bookingId: string
  payTo: PayToOption[]
  /** Batas dari `paymentLimits` (server): bawaan nominal = sisa; minimal = DP / sisa menuju DP. Server menilai ulang di dalam kunci. */
  balance: number
  minClaim: number
}

// Bukti transfer + data transfer (Fase 7a F2). Nominal bisa diubah supaya pelanggan boleh membayar DP dulu; semua pemeriksaan sungguhan
// (batas nominal, berkas dari isinya, rekening) di server, pesan penolakannya ditampilkan apa adanya.
export function PaymentProofUpload({ bookingId, payTo, balance, minClaim }: Props) {
  const router = useRouter()
  const t = useTranslations('pilgrimArea.payment')
  const errorText = useApiError()
  const [amount, setAmount] = useState(String(Math.round(balance)))
  const [transferredAt, setTransferredAt] = useState<string | null>(() => new Date().toISOString())
  const [destination, setDestination] = useState(payTo.length === 1 ? '0' : '')
  const [senderBank, setSenderBank] = useState('')
  const [senderAccountName, setSenderAccountName] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountNum = Number(amount)
  const amountOk = /^\d{1,10}$/.test(amount) && amountNum >= minClaim && amountNum <= balance
  const ready = !!file && amountOk && !!transferredAt && destination !== '' && senderBank.trim().length >= 2 && senderAccountName.trim().length >= 2

  async function submit() {
    if (!ready || saving || !file || !transferredAt) return
    setSaving(true); setError(null)
    const body = new FormData()
    body.append('amount', amount)
    body.append('transferredAt', transferredAt)
    body.append('destination', destination)
    body.append('senderBank', senderBank)
    body.append('senderAccountName', senderAccountName)
    if (note.trim()) body.append('note', note)
    body.append('file', file)
    try {
      const res = await fetch(`/api/v1/bookings/${bookingId}/payment/bukti`, { method: 'POST', body })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) { setError(errorText(json, t('failed'))); return }
      router.refresh()
    } catch {
      setError(t('network'))
    } finally {
      setSaving(false)
    }
  }

  const options = payTo.map((b, i) => ({ id: String(i), label: `${b.bankName} · ${b.accountNumber}`, hint: b.accountHolder }))
  const partial = amountOk && amountNum < balance

  return (
    <div className="space-y-4 rounded-lg bg-white/70 p-4">
      <p className="font-semibold">{t('formTitle')}</p>
      <div className="space-y-2">
        <Label htmlFor="pay-amount">{t('amount')}</Label>
        <Input id="pay-amount" inputMode="numeric" className="bg-white" value={amount}
          onChange={e => { setError(null); setAmount(e.target.value.replace(/\D/g, '').slice(0, 10)) }} />
        <p className="text-xs text-muted-foreground">
          {minClaim < balance ? t('amountRange', { min: formatRupiah(minClaim), max: formatRupiah(balance) }) : t('amountFull', { max: formatRupiah(balance) })}
        </p>
        {partial && <p className="text-xs font-medium text-amber-800">{t('amountPartial', { rest: formatRupiah(balance - amountNum) })}</p>}
      </div>
      <DateTimeField label={t('transferredAt')} value={transferredAt} onChange={setTransferredAt} required />
      <div className="space-y-2">
        <Label>{t('destination')}</Label>
        <ChoiceSelect options={options} value={destination} onChange={setDestination} placeholder={t('destinationPlaceholder')} ariaLabel={t('destination')} clearable={false} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pay-sender-bank">{t('senderBank')}</Label>
          <Input id="pay-sender-bank" className="bg-white" maxLength={100} value={senderBank} onChange={e => setSenderBank(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pay-sender-name">{t('senderAccountName')}</Label>
          <Input id="pay-sender-name" className="bg-white" maxLength={100} value={senderAccountName} onChange={e => setSenderAccountName(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="bukti-transfer">{t('label')}</Label>
        <Input id="bukti-transfer" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="bg-white"
          onChange={e => { setError(null); setFile(e.target.files?.[0] ?? null) }} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pay-note">{t('note')}</Label>
        <Textarea id="pay-note" className="bg-white" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
      <Button type="button" className="w-full" disabled={!ready || saving} onClick={submit}>
        <UploadCloud className="mr-2 h-4 w-4" /> {saving ? t('uploading') : t('submit')}
      </Button>
    </div>
  )
}
