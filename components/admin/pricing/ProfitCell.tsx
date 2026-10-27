import { formatRupiah } from '@/lib/utils'
import { cn } from '@/lib/utils'

/** Sel kolom "Untung" untuk daftar produk admin: Rp + persen dari modal; "—" bila modal belum lengkap; merah bila rugi. */
export function ProfitCell({ profitIdr, marginPct }: { profitIdr: number | null | undefined; marginPct: number | null | undefined }) {
  if (profitIdr == null) return <span className="text-[12px] text-admin-muted" title="Modal belum lengkap">—</span>
  return (
    <span className={cn('text-[12px] font-semibold tabular-nums', profitIdr < 0 ? 'text-admin-danger' : 'text-admin-ok')}>
      {formatRupiah(profitIdr)}{marginPct != null && <span className="ml-1 font-medium opacity-80">({marginPct.toFixed(1)}%)</span>}
    </span>
  )
}
