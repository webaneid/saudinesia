import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canTransferCash } from '@/lib/pricing/policy'
import { getTransfer } from '@/lib/cash/transfers'
import { CASH_COMPONENT_LABEL } from '@/lib/cash/labels'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ManageBox } from './ManageBox'
import { VoidTransfer } from './VoidTransfer'
import { adminHref } from '@/lib/admin/href'

// Detail transfer antar akun (docs/arsitektur-booking-engine-v2.md §10.14 Fase 12b): ringkasan, entri buku kas (termasuk pembalik), riwayat; batalkan di kanan
// (manager + superadmin). Baca: semua admin.
type Props = { params: Promise<{ locale: string; id: string }> }
type Entry = { id: string; at: Date; direction: 'in' | 'out'; component: keyof typeof CASH_COMPONENT_LABEL; account: string; amount: number }

export default async function CashTransferDetail({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const t = await getTransfer(id)
  if (!t) notFound()
  const own = await prisma.cashEntry.findMany({ where: { refType: { in: ['transfer_out', 'transfer_in'] }, refId: id }, select: { id: true } })
  const raw = await prisma.cashEntry.findMany({
    where: { OR: [{ refType: { in: ['transfer_out', 'transfer_in'] }, refId: id }, { reversesEntryId: { in: own.map(e => e.id) } }] },
    orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], take: 20, // satu transfer: ≤ 3 entri + ≤ 3 pembalik
    select: { id: true, entryDate: true, direction: true, component: true, amountIdr: true, cashAccount: { select: { name: true, bankAccount: { select: { bankName: true, accountNumber: true } } } } },
  })
  const entries: Entry[] = raw.map(e => ({ id: e.id, at: e.entryDate, direction: e.direction, component: e.component, amount: Number(e.amountIdr), account: e.cashAccount.bankAccount ? `${e.cashAccount.bankAccount.bankName} ${e.cashAccount.bankAccount.accountNumber}` : e.cashAccount.name }))
  const staffIds = [t.createdById, t.voidedById].filter((v): v is string => !!v)
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
      backHref={adminHref(locale, `/admin/finance/transfers`)} backLabel="Transfer Antar Akun"
      title={(
        <div className="space-y-1">
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-xl font-semibold text-admin-ink">Transfer {formatRupiah(t.amountIdr)} <Badge tone={t.voided ? 'neutral' : 'ok'}>{t.voided ? 'Dibatalkan' : 'Berlaku'}</Badge></h1>
          <p className="m-0 text-[12px] text-admin-muted">{t.from} → {t.to}</p>
        </div>
      )}
      main={(
        <>
          <ManageBox title="Ringkasan" icon="summary">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
              <div><dt className="text-[11px] text-admin-muted">Dari akun</dt><dd className="m-0 text-admin-ink">{t.from}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Ke akun</dt><dd className="m-0 text-admin-ink">{t.to}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Jumlah dipindahkan</dt><dd className="m-0 font-semibold tabular-nums text-admin-ink">{formatRupiah(t.amountIdr)}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Biaya transfer</dt><dd className="m-0 tabular-nums text-admin-ink">{t.feeIdr > 0 ? formatRupiah(t.feeIdr) : '—'}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Waktu transfer</dt><dd className="m-0 tabular-nums text-admin-ink">{fmt(t.transferredAt)}</dd></div>
              {t.note && <div className="sm:col-span-2"><dt className="text-[11px] text-admin-muted">Catatan</dt><dd className="m-0 break-words text-admin-ink">{t.note}</dd></div>}
            </dl>
          </ManageBox>
          <ManageBox title="Entri buku kas" icon="entries" description="Entri yang dicatat transfer ini, termasuk pembalik bila dibatalkan.">
            <DataTable columns={columns} rows={entries} getRowId={e => e.id} empty="Tidak ada entri." />
          </ManageBox>
          <ManageBox title="Riwayat" icon="history">
            <ol className="m-0 list-none space-y-2 p-0 text-[12px]">
              <li><span className="font-semibold text-admin-ink">Dicatat</span><span className="text-admin-muted"> · {fmt(t.createdAt)} · {who(t.createdById)}</span></li>
              {t.voidedAt && <li><span className="font-semibold text-admin-ink">Dibatalkan</span><span className="text-admin-muted"> · {fmt(t.voidedAt)} · {who(t.voidedById)}</span>{t.voidReason && <span className="block break-words text-admin-muted">{t.voidReason}</span>}</li>}
            </ol>
          </ManageBox>
        </>
      )}
      sidebar={(
        <ManageBox title="Tindakan" icon="actions" collapsible={false}>
          {t.voided
            ? <p className="m-0 text-[12px] text-admin-muted">Transfer ini sudah dibatalkan — tidak ada tindakan lagi.</p>
            : canTransferCash(session.role)
              ? <VoidTransfer id={t.id} amount={t.amountIdr} />
              : <p className="m-0 text-[12px] text-admin-muted">Hanya manager/superadmin yang dapat membatalkan transfer.</p>}
        </ManageBox>
      )}
    />
  )
}
