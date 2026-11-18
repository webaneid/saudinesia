import { BadgeCheck } from 'lucide-react'
import { Card } from '@/components/admin/ui/Card'
import { formatRupiah } from '@/lib/utils'
import { REVENUE_SHARE_BASIS_LABEL } from '@/lib/revenue-share/example'
import type { ShareStatus } from '@/lib/revenue-share/entitlement'

// Bagi hasil Platform Provider per booking (docs/arsitektur-bagi-hasil.md §5c): potensi (aturan beku × harga) vs hak (dari pembayaran berhasil).
// Hanya dirender untuk superadmin (rincian internal, SEC-281); tanpa aturan beku (invoice lama / belum ada Platform Provider) tidak dirender.

const pct = (n: number) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`

export function RevenueShareBox({ s }: { s: ShareStatus }) {
  if (s.percent == null || s.basis == null) return null
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <BadgeCheck className="size-4 text-admin-accent" />
        <h2 className="m-0 text-sm font-bold">Bagi hasil Platform Provider</h2>
        <span className="text-[12px] text-admin-muted">{pct(s.percent)} · {REVENUE_SHARE_BASIS_LABEL[s.basis]} (beku di invoice)</span>
      </div>
      <dl className="m-0 grid grid-cols-3 gap-3 text-[13px]">
        <div><dt className="text-admin-muted">Potensi</dt><dd className="m-0 font-semibold tabular-nums">{formatRupiah(s.potentialIdr)}</dd></div>
        <div><dt className="text-admin-muted">Hak (dari pembayaran)</dt><dd className="m-0 font-semibold tabular-nums">{formatRupiah(s.entitledIdr)}</dd></div>
        <div><dt className="text-admin-muted">Terbayar</dt><dd className="m-0 font-semibold tabular-nums">{pct(s.paidRatio * 100)}</dd></div>
      </dl>
      <p className="m-0 text-[12px] text-admin-muted">Hak dihitung hanya dari pembayaran yang terverifikasi, sebanding dengan bagian tagihan yang terbayar; refund dan revisi menyesuaikannya.</p>
    </Card>
  )
}
