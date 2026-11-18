'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { HandCoins } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DateTimeField } from '@/components/shared/DateTimeField'
import { formatRupiah } from '@/lib/utils'

type Option = { value: string; label: string }
type Options = { cashAccounts: Option[]; recipients: Array<Option & { version: string }>; balanceIdr: number }

// Catat pencairan bagi hasil (Fase 13e-1): superadmin klien saja (API menolak akun Platform Provider). Akun kas asal (tanpa QRIS), rekening Platform Provider
// aktif, dan saldo dari GET …/payouts/options; batas saldo dan aturan waktu dinilai server.
export default function NewPayoutPage() {
  const { locale } = useParams() as { locale: string }
  const list = `/${locale}/admin/system/platform-provider/payouts`
  const [options, setOptions] = useState<Options | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/v1/admin/system/platform-provider/payouts/options').then(r => r.json().then(j => ({ r, j })))
      .then(({ r, j }) => { if (live) { if (r.ok && j?.data) setOptions(j.data as Options); else setLoadError(j?.error ?? 'Pilihan gagal dimuat.') } })
      .catch(() => { if (live) setLoadError('Tidak dapat menghubungi server.') })
    return () => { live = false }
  }, [])
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/system/platform-provider/payouts', id => `${list}/${id}`, 'Pencairan gagal dicatat.')
  const [cashAccount, setCashAccount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [at, setAt] = useState<string | null>(() => new Date().toISOString())
  const [note, setNote] = useState('')

  const amountNum = Number(amount)
  const over = options !== null && amountNum > options.balanceIdr
  const valid = cashAccount !== '' && recipient !== '' && /^\d{1,12}$/.test(amount) && amountNum > 0 && !over && !!at
  const change = (fn: (v: string) => void) => (v: string) => { clearError(); fn(v) }
  const opts = (xs: Option[] | undefined) => (xs ?? []).map(o => ({ id: o.value, label: o.label }))

  return (
    <CreatePage icon={HandCoins} title="Catat Pencairan" backHref={list} backLabel="Pencairan Bagi Hasil"
      description={options ? `Saldo bagi hasil belum dicairkan: ${formatRupiah(options.balanceIdr)}. Pencairan tidak boleh melebihi saldo.` : 'Memuat saldo…'}
      onSubmit={() => submit({ amount: amountNum, paidAt: at, cashAccount, recipientAccountId: recipient, recipientVersion: options?.recipients.find(o => o.value === recipient)?.version, note: note.trim() || null })}
      saving={saving} canSubmit={valid} error={loadError ?? error} submitLabel="Catat pencairan">
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="m-0 text-xs font-semibold text-admin-ink">Dibayar dari akun kas</p>
            <ChoiceSelect ariaLabel="Akun kas asal" placeholder="Pilih akun kas" options={opts(options?.cashAccounts)} value={cashAccount} onChange={change(setCashAccount)} clearable={false} />
          </div>
          <div className="space-y-1">
            <p className="m-0 text-xs font-semibold text-admin-ink">Ke rekening Platform Provider</p>
            <ChoiceSelect ariaLabel="Rekening tujuan" placeholder={options && options.recipients.length === 0 ? 'Belum ada rekening aktif' : 'Pilih rekening tujuan'} options={opts(options?.recipients)} value={recipient} onChange={change(setRecipient)} clearable={false} />
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-admin-muted">Jumlah dicairkan (Rp)</span>
          <input className="admin-inp" inputMode="numeric" value={amount} onChange={e => { clearError(); setAmount(e.target.value.replace(/\D/g, '').slice(0, 12)) }} />
        </label>
        {over && options && <p role="status" className="m-0 rounded-xl bg-admin-warning/14 px-3 py-2 text-[12px] text-admin-warning">Jumlah melebihi saldo bagi hasil belum dicairkan ({formatRupiah(options.balanceIdr)}).</p>}
        <DateTimeField value={at} onChange={v => { clearError(); setAt(v) }} label="Waktu bayar" />
        <label className="block">
          <span className="mb-1 block text-xs text-admin-muted">Catatan (opsional, mis. nomor referensi bank — tanpa data pelanggan)</span>
          <input className="admin-inp" maxLength={200} value={note} onChange={e => { clearError(); setNote(e.target.value) }} />
        </label>
      </div>
    </CreatePage>
  )
}
