'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeftRight, Download } from 'lucide-react'
import type { CashComponent, CashDirection } from '@prisma/client'
import { cn, formatRupiah } from '@/lib/utils'
import { DATE_SHORT_MONTH, formatCalendarDate } from '@/lib/time'
import { CASH_COMPONENT_LABEL } from '@/lib/cash/labels'
import { periodPresets } from '@/lib/admin/period'
import { DataTable } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { PeriodFilter } from '@/components/admin/data-table/PeriodFilter'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Card } from '@/components/admin/ui/Card'

// Arus kas (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12a): saldo awal → masuk/keluar per komponen → saldo akhir, per akun. Baca saja; data dari
// GET /api/v1/admin/finance/cash-flow (angka = buku kas). Filter di URL (daftar putih di server).

type AccountFlow = { id: string; name: string; openingIdr: number; inIdr: number; outIdr: number; closingIdr: number }
type ComponentFlow = { direction: CashDirection; component: CashComponent; amountIdr: number }
type Flow = { from: string; to: string; accounts: AccountFlow[]; components: ComponentFlow[]; openingIdr: number; inIdr: number; outIdr: number; closingIdr: number }
type Data = { flow: Flow; accounts: Array<{ id: string; name: string }> }

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <div className="rounded-xl border border-admin-line bg-white p-3">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-admin-muted">{label}</p>
      <p className={cn('m-0 mt-1 text-lg font-extrabold tabular-nums', tone === 'ok' && 'text-admin-ok', tone === 'danger' && 'text-admin-danger')}>{value}</p>
    </div>
  )
}

function ComponentTable({ title, rows, total, empty }: { title: string; rows: ComponentFlow[]; total: number; empty: string }) {
  return (
    <Card className="space-y-2 p-4">
      <h2 className="m-0 text-sm font-bold">{title}</h2>
      <DataTable
        columns={[
          { key: 'c', header: 'Komponen', mobile: 'title', cell: (r: ComponentFlow) => <span className="text-admin-ink">{CASH_COMPONENT_LABEL[r.component]}</span> },
          { key: 'n', header: 'Jumlah', align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.amountIdr)}</span> },
          { key: 'p', header: 'Porsi', align: 'right', hideBelowLg: true, cell: r => <span className="tabular-nums text-admin-muted">{total > 0 ? `${Math.round(r.amountIdr / total * 1000) / 10}%` : '—'}</span> },
        ]}
        rows={rows} getRowId={r => `${r.direction}:${r.component}`} empty={empty}
      />
    </Card>
  )
}

export default function CashFlowPage() {
  const { locale } = useParams() as { locale: string }
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  const def = useMemo(() => periodPresets()[0]!, [])
  const from = search.get('from') ?? def.from
  const to = search.get('to') ?? def.to
  const account = search.get('account') ?? ''
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const query = useCallback((extra: Record<string, string> = {}) => {
    const q = new URLSearchParams({ from, to, ...(account ? { account } : {}) })
    for (const [k, v] of Object.entries(extra)) { if (v) q.set(k, v); else q.delete(k) }
    return q
  }, [from, to, account])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/v1/admin/finance/cash-flow?${query()}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.data) { setError(j?.error ?? 'Arus kas gagal dimuat.'); setData(null); return }
      setData(j.data)
    } catch { setError('Tidak dapat menghubungi server.') } finally { setLoading(false) }
  }, [query])
  useEffect(() => { void load() }, [load])

  const go = (extra: Record<string, string>) => router.replace(`${pathname}?${query(extra)}`, { scroll: false })
  const f = data?.flow
  const ins = f?.components.filter(c => c.direction === 'in') ?? []
  const outs = f?.components.filter(c => c.direction === 'out') ?? []
  const fromLabel = formatCalendarDate(from, DATE_SHORT_MONTH)
  const toLabel = formatCalendarDate(to, DATE_SHORT_MONTH)

  return (
    <div className="space-y-5">
      <PageHeader icon={ArrowLeftRight} title="Arus Kas" description="Dari mana uang masuk dan ke mana keluar dalam satu periode. Semua angka dari buku kas: saldo awal + masuk − keluar = saldo akhir."
        actions={<><Link href={`/${locale}/admin/finance/cash-book?${query()}`} className="admin-btn-sm">Buku Kas</Link><a href={`/api/v1/admin/finance/cash-flow/export?${query()}`} className="admin-btn-sm inline-flex items-center gap-1.5"><Download className="size-3.5" />Unduh CSV</a></>} />
      <FilterBar active={from !== def.from || to !== def.to || !!account} resetHref={pathname}>
        <PeriodFilter from={from} to={to} onChange={r => go({ from: r.from, to: r.to })} />
        <FilterSelect label="Akun" allLabel="Semua akun" value={account} options={(data?.accounts ?? []).map(a => ({ value: a.id, label: a.name }))} onChange={v => go({ account: v })} />
      </FilterBar>

      {error && <p role="alert" className="text-sm font-medium text-admin-danger">{error}</p>}

      {f && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label={`Saldo awal ${fromLabel}`} value={formatRupiah(f.openingIdr)} />
          <Stat label="Masuk" value={formatRupiah(f.inIdr)} tone="ok" />
          <Stat label="Keluar" value={formatRupiah(f.outIdr)} tone={f.outIdr > 0 ? 'danger' : undefined} />
          <Stat label={`Saldo akhir ${toLabel}`} value={formatRupiah(f.closingIdr)} />
        </div>
      )}

      {f && (
        <div className="grid gap-4 lg:grid-cols-2">
          <ComponentTable title="Uang masuk per komponen" rows={ins} total={f.inIdr} empty="Tidak ada uang masuk pada periode ini." />
          <ComponentTable title="Uang keluar per komponen" rows={outs} total={f.outIdr} empty="Tidak ada uang keluar pada periode ini." />
        </div>
      )}

      <Card className="space-y-2 p-4">
        <h2 className="m-0 text-sm font-bold">Per akun kas</h2>
        <DataTable
          columns={[
            { key: 'n', header: 'Akun', mobile: 'title', cell: (r: AccountFlow) => <span className="font-semibold text-admin-ink">{r.name}</span> },
            { key: 's', header: 'Saldo awal', align: 'right', cell: r => <span className="tabular-nums text-admin-muted">{formatRupiah(r.openingIdr)}</span> },
            { key: 'i', header: 'Masuk', align: 'right', cell: r => <span className="tabular-nums text-admin-ok">{formatRupiah(r.inIdr)}</span> },
            { key: 'o', header: 'Keluar', align: 'right', cell: r => <span className="tabular-nums text-admin-danger">{formatRupiah(r.outIdr)}</span> },
            { key: 'b', header: 'Saldo akhir', align: 'right', cell: r => <span className="font-semibold tabular-nums">{formatRupiah(r.closingIdr)}</span> },
          ]}
          rows={f?.accounts ?? []} getRowId={r => r.id} loading={loading} empty="Belum ada akun kas — akun dibuat saat uang pertama masuk ke rekening."
        />
      </Card>
    </div>
  )
}
