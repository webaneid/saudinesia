import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canRecordPayout } from '@/lib/revenue-share/policy'
import { getPayout } from '@/lib/revenue-share/payouts'
import { CASH_COMPONENT_LABEL } from '@/lib/cash/labels'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ManageBox } from './ManageBox'
import { VoidPayout } from './VoidPayout'
import { adminHref } from '@/lib/admin/href'

// Detail pencairan bagi hasil (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e): ringkasan (rekening tujuan = salinan beku saat dibayar), entri buku kas
// (termasuk pembalik), riwayat; batalkan di kanan (superadmin klien). Baca: superadmin.
type Props = { params: Promise<{ locale: string; id: string }> }
type Entry = { id: string; at: Date; direction: 'in' | 'out'; component: keyof typeof CASH_COMPONENT_LABEL; account: string; amount: number }

export default async function RevenueSharePayoutDetail({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const p = await getPayout(id)
  if (!p) notFound()
  const own = await prisma.cashEntry.findMany({ where: { refType: 'revenue_share_payout', refId: id }, select: { id: true } })
  const raw = await prisma.cashEntry.findMany({
    where: { OR: [{ refType: 'revenue_share_payout', refId: id }, { reversesEntryId: { in: own.map(e => e.id) } }] },
    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], take: 10, // satu pencairan: 1 entri + ≤ 1 pembalik
    select: { id: true, entryDate: true, direction: true, component: true, amountIdr: true, cashAccount: { select: { name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } } },
  })
  const entries: Entry[] = raw.map(e => ({ id: e.id, at: e.entryDate, direction: e.direction, component: e.component, amount: Number(e.amountIdr), account: e.cashAccount.bankAccount ? `${e.cashAccount.bankAccount.bankName} ${e.cashAccount.bankAccount.accountNumber}` : e.cashAccount.name }))
  const staffIds = [p.createdById, p.voidedById].filter((v): v is string => !!v)
  const staff = new Map((await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]))
  const who = (v: string | null) => (v ? staff.get(v) ?? 'staf' : 'sistem')
  const fmt = (d: Date | string) => formatInstant(d, DATETIME_MEDIUM)

  const columns: Column<Entry>[] = [
    { key: 'at', header: 'Waktu', mobile: 'title', cell: e => <span className="text-[12px] tabular-nums">{fmt(e.at)}</span> },
    { key: 'what', header: 'Komponen', cell: e => <span className="text-[12px]">{CASH_COMPONENT_LABEL[e.component]}</span> },
    { key: 'acc', header: 'Akun kas', cell: e => <span className="text-[12px] text-admin-muted">{e.account}</span> },
    { key: 'amt', header: 'Jumlah', align: 'right', cell: e => <span className={`text-[12px] font-semibold tabular-nums ${e.direction === 'in' ? 'text-admin-ok' : 'text-admin-danger'}`}>{e.direction === 'in' ? '+' : '−'}{formatRupiah(e.amount)}</span> },
  ]

  return (
    <EditorShell
      backHref={adminHref(locale, `/admin/system/platform-provider/payouts`)} backLabel="Pencairan Bagi Hasil"
      title={(
        <div className="space-y-1">
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-xl font-semibold text-admin-ink">Pencairan {formatRupiah(p.amountIdr)} <Badge tone={p.voided ? 'neutral' : 'ok'}>{p.voided ? 'Dibatalkan' : 'Berlaku'}</Badge></h1>
          <p className="m-0 text-[12px] text-admin-muted">{p.from} → {p.to}</p>
        </div>
      )}
      main={(
        <>
          <ManageBox title="Ringkasan" icon="summary">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
              <div><dt className="text-[11px] text-admin-muted">Dibayar dari</dt><dd className="m-0 text-admin-ink">{p.from}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Rekening tujuan (saat dibayar)</dt><dd className="m-0 text-admin-ink">{p.to}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Jumlah</dt><dd className="m-0 font-semibold tabular-nums text-admin-ink">{formatRupiah(p.amountIdr)}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Waktu bayar</dt><dd className="m-0 tabular-nums text-admin-ink">{fmt(p.paidAt)}</dd></div>
              {p.note && <div className="sm:col-span-2"><dt className="text-[11px] text-admin-muted">Catatan</dt><dd className="m-0 break-words text-admin-ink">{p.note}</dd></div>}
            </dl>
          </ManageBox>
          <ManageBox title="Entri buku kas" icon="entries" description="Entri yang dicatat pencairan ini, termasuk pembalik bila dibatalkan.">
            <DataTable columns={columns} rows={entries} getRowId={e => e.id} empty="Tidak ada entri." />
          </ManageBox>
          <ManageBox title="Riwayat" icon="history">
            <ol className="m-0 list-none space-y-2 p-0 text-[12px]">
              <li><span className="font-semibold text-admin-ink">Dicatat</span><span className="text-admin-muted"> · {fmt(p.createdAt)} · {who(p.createdById)}</span></li>
              {p.voidedAt && <li><span className="font-semibold text-admin-ink">Dibatalkan</span><span className="text-admin-muted"> · {fmt(p.voidedAt)} · {who(p.voidedById)}</span>{p.voidReason && <span className="block break-words text-admin-muted">{p.voidReason}</span>}</li>}
            </ol>
          </ManageBox>
        </>
      )}
      sidebar={(
        <ManageBox title="Tindakan" icon="actions" collapsible={false}>
          {p.voided
            ? <p className="m-0 text-[12px] text-admin-muted">Pencairan ini sudah dibatalkan — tidak ada tindakan lagi.</p>
            : canRecordPayout(session)
              ? <VoidPayout id={p.id} amount={p.amountIdr} />
              : <p className="m-0 text-[12px] text-admin-muted">Pencairan dicatat dan dibatalkan oleh superadmin perusahaan.</p>}
        </ManageBox>
      )}
    />
  )
}
