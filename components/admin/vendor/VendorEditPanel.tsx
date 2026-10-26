'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Power, Trash2 } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'
import { Button } from '@/components/admin/ui/Button'
import { VendorForm } from './VendorForm'
import type { VendorCategoryOption, VendorRecord } from './types'

export type VendorUsageView = { costsByType: Record<string, number>; costs: number; preferred: number; visaSnapshots: number; total: number }

const COST_TYPE_LABEL: Record<string, string> = {
  package: 'Paket Umroh', tour_package: 'Paket Ziarah', haji: 'Haji', visa: 'Visa',
  flight: 'Pesawat', hotel: 'Hotel', transport: 'Transport', muthowif: 'Muthowif',
}

type Props = { locale: string; vendor: VendorRecord; usage: VendorUsageView; categories: VendorCategoryOption[] }
type Notice = { text: string; error: boolean }

/** Halaman detail vendor: formulir lengkap + panel pemakaian + zona nonaktif/hapus (CRUD lengkap, hapus aman). */
export function VendorEditPanel({ locale, vendor, usage, categories }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState<'deactivate' | 'delete' | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  async function setActive(isActive: boolean) {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/system/vendors/${vendor.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) return setNotice({ text: json?.error ?? 'Status vendor gagal diubah', error: true })
      setConfirming(null)
      setNotice({ text: isActive ? 'Vendor diaktifkan kembali.' : 'Vendor dinonaktifkan.', error: false })
      router.refresh()
    } finally { setBusy(false) }
  }

  async function remove() {
    setBusy(true); setNotice(null)
    try {
      const res = await fetch(`/api/v1/admin/system/vendors/${vendor.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) return setNotice({ text: json?.error ?? 'Vendor gagal dihapus', error: true })
      if (json.data?.deleted) return router.push(`/${locale}/admin/system/vendors`)
      setConfirming(null)
      setNotice({ text: json.data?.message ?? 'Vendor dipakai sehingga dinonaktifkan.', error: false })
      router.refresh()
    } finally { setBusy(false) }
  }

  const costRows = Object.entries(usage.costsByType)

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="kartu p-5">
        <VendorForm vendor={vendor} categories={categories} onSaved={() => { setNotice({ text: 'Perubahan tersimpan.', error: false }); router.refresh() }} />
      </div>

      <div className="grid content-start gap-5">
        <section className="kartu grid gap-3 p-5" aria-label="Pemakaian vendor">
          <h2 className="m-0 text-sm font-bold text-admin-ink">Pemakaian</h2>
          {usage.total === 0 ? (
            <p className="m-0 text-sm text-admin-muted">Belum dipakai di mana pun — aman dihapus.</p>
          ) : (
            <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
              {costRows.map(([type, n]) => (
                <li key={type} className="flex justify-between"><span className="text-admin-muted">Komponen biaya {COST_TYPE_LABEL[type] ?? type}</span><span className="font-semibold tabular-nums">{n}</span></li>
              ))}
              <li className="flex justify-between"><span className="text-admin-muted">Vendor pilihan</span><span className="font-semibold tabular-nums">{usage.preferred}</span></li>
              <li className="flex justify-between"><span className="text-admin-muted">Riwayat visa</span><span className="font-semibold tabular-nums">{usage.visaSnapshots}</span></li>
            </ul>
          )}
        </section>

        <section className="kartu grid gap-3 p-5" aria-label="Status dan hapus">
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-bold text-admin-ink">Status</h2>
            <div className="flex gap-1">
              <Badge tone={vendor.isActive ? 'ok' : 'neutral'}>{vendor.isActive ? 'Aktif' : 'Nonaktif'}</Badge>
              {vendor.isSystem && <Badge tone="accent">Sistem</Badge>}
            </div>
          </div>

          {vendor.isSystem ? (
            <p className="m-0 text-sm text-admin-muted">Vendor sistem dipakai otomatis oleh modul (mis. Muthowif) — tidak dapat dinonaktifkan atau dihapus.</p>
          ) : confirming ? (
            <div className="grid gap-2">
              <p className="m-0 text-sm text-admin-ink">
                {confirming === 'delete'
                  ? (usage.total === 0 ? 'Hapus vendor ini secara permanen?' : 'Vendor ini dipakai sehingga tidak bisa dihapus permanen — ia akan dinonaktifkan. Lanjutkan?')
                  : 'Nonaktifkan vendor? Vendor tidak muncul di pilihan baru; biaya yang sudah memakainya tidak berubah.'}
              </p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" disabled={busy} onClick={() => (confirming === 'delete' ? remove() : setActive(false))}>
                  {busy && <Loader2 className="size-4 animate-spin" />} Ya, lanjutkan
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Batal</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {vendor.isActive ? (
                <Button variant="outline" size="sm" onClick={() => setConfirming('deactivate')}><Power className="size-4" /> Nonaktifkan</Button>
              ) : (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => setActive(true)}><Power className="size-4" /> Aktifkan kembali</Button>
              )}
              <Button variant="danger" size="sm" onClick={() => setConfirming('delete')}><Trash2 className="size-4" /> Hapus</Button>
            </div>
          )}

          {notice && <p role="status" className={`m-0 text-sm font-medium ${notice.error ? 'text-admin-danger' : 'text-admin-ok'}`}>{notice.text}</p>}
        </section>
      </div>
    </div>
  )
}
