'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { DateTimeField } from '@/components/shared/DateTimeField'
import { formatRupiah } from '@/lib/utils'
import type { TransferAccountOption } from '@/lib/cash/transfers'
import { adminHref } from '@/lib/admin/href'

// Catat transfer antar akun (§10.14 Fase 12b; manager + superadmin — API menolak peran lain). Pilihan akun + saldo dari GET …/transfers/options. Aturan akun (ada, bukan QRIS, berbeda) dan waktu dinilai server; saldo hanya PERINGATAN — buku kas belum memuat
// saldo sebelum sistem dipakai, jadi transfer melebihi saldo tercatat tidak ditolak.
export default function NewTransferPage() {
  const { locale } = useParams() as { locale: string }
  const [options, setOptions] = useState<TransferAccountOption[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/v1/admin/finance/transfers/options').then(r => r.json().then(j => ({ r, j })))
      .then(({ r, j }) => { if (live) { if (r.ok && Array.isArray(j?.data)) setOptions(j.data); else setLoadError(j?.error ?? 'Pilihan akun gagal dimuat.') } })
      .catch(() => { if (live) setLoadError('Tidak dapat menghubungi server.') })
    return () => { live = false }
  }, [])
  const { saving, error, clearError, submit } = useCreateEntity('/api/v1/admin/finance/transfers', id => adminHref(locale, `/admin/finance/transfers/${id}`), 'Transfer gagal dicatat.')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('')
  const [at, setAt] = useState<string | null>(() => new Date().toISOString())
  const [note, setNote] = useState('')

  const amountNum = Number(amount)
  const feeNum = fee === '' ? 0 : Number(fee)
  const source = options.find(o => o.value === from)
  const valid = from !== '' && to !== '' && from !== to && /^\d{1,12}$/.test(amount) && amountNum > 0 && /^\d{0,12}$/.test(fee) && !!at
  const over = source && valid && amountNum + feeNum > source.balanceIdr
  const choices = (exclude: string, receiving = false) => options.filter(o => o.value !== exclude && (!receiving || o.canReceive)).map(o => ({ id: o.value, label: o.label, hint: `saldo ${formatRupiah(o.balanceIdr)}` }))
  const change = (fn: (v: string) => void) => (v: string) => { clearError(); fn(v) }

  return (
    <CreatePage
      icon={ArrowLeftRight} title="Catat Transfer" backHref={adminHref(locale, `/admin/finance/transfers`)} backLabel="Transfer Antar Akun"
      description="Memindahkan saldo antar akun kas milik perusahaan. Akun asal mencatat uang keluar (+ biaya transfer), akun tujuan uang masuk."
      onSubmit={() => submit({ from, to, amount: amountNum, fee: feeNum, transferredAt: at, note: note.trim() || null })}
      saving={saving} canSubmit={valid} error={loadError ?? error} submitLabel="Catat transfer"
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="m-0 text-xs font-semibold text-admin-ink">Dari akun</p>
            <ChoiceSelect ariaLabel="Akun asal" placeholder="Pilih akun asal" options={choices(to)} value={from} onChange={change(setFrom)} clearable={false} />
          </div>
          <div className="space-y-1">
            <p className="m-0 text-xs font-semibold text-admin-ink">Ke akun</p>
            <ChoiceSelect ariaLabel="Akun tujuan" placeholder="Pilih akun tujuan" options={choices(from, true)} value={to} onChange={change(setTo)} clearable={false} />
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-admin-muted">Jumlah dipindahkan (Rp)</span>
            <input className="admin-inp" inputMode="numeric" value={amount} onChange={e => { clearError(); setAmount(e.target.value.replace(/\D/g, '').slice(0, 12)) }} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-admin-muted">Biaya transfer (Rp, opsional — keluar dari akun asal)</span>
            <input className="admin-inp" inputMode="numeric" value={fee} onChange={e => { clearError(); setFee(e.target.value.replace(/\D/g, '').slice(0, 12)) }} />
          </label>
        </div>
        {over && <p role="status" className="m-0 rounded-xl bg-admin-warning/14 px-3 py-2 text-[12px] text-admin-warning">Jumlah + biaya ({formatRupiah(amountNum + feeNum)}) melebihi saldo tercatat {source.label} ({formatRupiah(source.balanceIdr)}). Tetap bisa dicatat bila saldo sebelum sistem dipakai belum tercatat.</p>}
        <DateTimeField value={at} onChange={v => { clearError(); setAt(v) }} label="Waktu transfer" />
        <label className="block">
          <span className="mb-1 block text-xs text-admin-muted">Catatan (opsional, mis. nomor referensi bank — tanpa data pelanggan)</span>
          <input className="admin-inp" maxLength={200} value={note} onChange={e => { clearError(); setNote(e.target.value) }} />
        </label>
      </div>
    </CreatePage>
  )
}
