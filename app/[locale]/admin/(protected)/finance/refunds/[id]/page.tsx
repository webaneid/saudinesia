import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { canManageRefund } from '@/lib/pricing/policy'
import { billOf, billRefunds } from '@/lib/invoice/bill'
import { refundableOf } from '@/lib/refunds/service'
import { APPROVAL_MODE_LABEL, FORCE_MAJEURE_LABEL, REFUND_SOURCE_LABEL, REFUND_STATUS } from '@/lib/refunds/labels'
import { approvalFactsOf, evaluateRefundApproval } from '@/lib/refunds/approval'
import { getRefundSettings } from '@/lib/refunds/settings'
import { cashTargetOptions } from '@/lib/cash/accounts'
import { CASH_COMPONENT_LABEL } from '@/lib/cash/labels'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import { formatRupiah } from '@/lib/utils'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { Badge } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { ManageBox } from './ManageBox'
import { RefundActions } from './RefundActions'
import { adminHref } from '@/lib/admin/href'

// Detail refund (SEC-244, docs/arsitektur-booking-engine-v2.md §10.13): ringkasan, arus uang booking dari buku kas, rekening tujuan, riwayat langkah; tindakan di
// kanan (hanya peran refund). Baca: semua admin.
type Props = { params: Promise<{ locale: string; id: string }> }
type Flow = { id: string; at: Date; direction: 'in' | 'out'; component: keyof typeof CASH_COMPONENT_LABEL; account: string; amount: number; mine: boolean }

const MAX_FLOW = 200 // arus uang satu booking — kecil; dibatasi supaya halaman tetap terbatas

export default async function RefundDetail({ params }: Props) {
  const { locale, id } = await params
  const session = await requireAdminPage(locale)
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const r = await prisma.refund.findUnique({
    where: { id },
    include: {
      cashAccount: { select: { name: true } },
      booking: { select: { id: true, bookingCode: true, status: true, totalAmount: true, invoice: { select: { taxAddedIdr: true, taxIncludedIdr: true } }, payments: { where: { status: 'confirmed' }, select: { status: true, amount: true } }, refunds: billRefunds, user: { select: { fullName: true } } } },
    },
  })
  if (!r) notFound()
  const canManage = canManageRefund(session.role)
  const bill = billOf(r.booking)
  const { max } = await refundableOf(prisma, r.bookingId, r.id)
  // Persetujuan (docs/rencana-force-majeure.md): dinilai sama dengan layanan; server menilai ULANG di dalam kunci saat menyetujui.
  const open = r.status === 'pending' || r.status === 'approved'
  const settings = await getRefundSettings()
  const facts = open && r.source === 'cancellation' ? await approvalFactsOf(prisma, r.bookingId, Number(r.amount), r.source, r.id) : null
  const verdict = facts ? evaluateRefundApproval(facts, settings.approvalMode, r.forceMajeureCategory) : null
  const approveBlocked = r.status !== 'pending' || !verdict ? null
    : verdict.needsForceMajeure ? 'Melebihi kebijakan pembatalan — ubah dan tandai force-majeure sebelum disetujui.'
    : verdict.needsSuperadmin && session.role !== 'superadmin' ? `Wajib disetujui superadmin (${APPROVAL_MODE_LABEL[settings.approvalMode].label.toLowerCase()}).` : null
  const staffIds = [r.createdById, r.approvedById, r.rejectedById, r.paidById].filter((v): v is string => !!v)
  const staff = new Map((await prisma.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } })).map(u => [u.id, u.fullName]))
  const who = (v: string | null) => (v ? staff.get(v) ?? 'staf' : 'sistem')
  const entries = await prisma.cashEntry.findMany({
    where: { bookingId: r.bookingId }, orderBy: [{ entryDate: 'asc' }, { id: 'asc' }], take: MAX_FLOW,
    select: { id: true, entryDate: true, direction: true, component: true, amountIdr: true, refType: true, refId: true, cashAccount: { select: { name: true } } },
  })
  const flows: Flow[] = entries.map(e => ({ id: e.id, at: e.entryDate, direction: e.direction, component: e.component, account: e.cashAccount.name, amount: Number(e.amountIdr), mine: e.refType === 'refund' && e.refId === r.id }))
  const totalIn = flows.filter(f => f.direction === 'in').reduce((s, f) => s + f.amount, 0)
  const totalOut = flows.filter(f => f.direction === 'out').reduce((s, f) => s + f.amount, 0)
  const recipient = r.recipientBank && r.recipientAccountNumber && r.recipientAccountName ? { bank: r.recipientBank, accountNumber: r.recipientAccountNumber, accountName: r.recipientAccountName } : null
  const status = REFUND_STATUS[r.status]
  const fmt = (d: Date) => formatInstant(d, DATETIME_MEDIUM)

  const columns: Column<Flow>[] = [
    { key: 'at', header: 'Waktu', mobile: 'title', cell: f => <span className="text-[12px] tabular-nums">{fmt(f.at)}</span> },
    { key: 'what', header: 'Komponen', cell: f => <span className="text-[12px]">{CASH_COMPONENT_LABEL[f.component]}{f.mine && <span className="ml-1.5 font-semibold text-admin-accent">· refund ini</span>}</span> },
    { key: 'acc', header: 'Akun kas', hideBelowLg: true, cell: f => <span className="text-[12px] text-admin-muted">{f.account}</span> },
    { key: 'amt', header: 'Jumlah', align: 'right', cell: f => <span className={`text-[12px] font-semibold tabular-nums ${f.direction === 'in' ? 'text-admin-ok' : 'text-admin-danger'}`}>{f.direction === 'in' ? '+' : '−'}{formatRupiah(f.amount)}</span> },
  ]
  const steps: Array<{ label: string; at: Date | null; by: string; note?: string | null }> = [
    { label: 'Diusulkan', at: r.createdAt, by: who(r.createdById) },
    ...(r.approvedAt ? [{ label: 'Disetujui', at: r.approvedAt, by: who(r.approvedById) }] : []),
    ...(r.rejectedAt ? [{ label: 'Ditolak', at: r.rejectedAt, by: who(r.rejectedById), note: r.notes }] : []),
    ...(r.paidAt ? [{ label: `Dibayar dari ${r.cashAccount?.name ?? 'akun kas'}`, at: r.paidAt, by: who(r.paidById), note: r.notes }] : []),
  ]

  return (
    <EditorShell
      backHref={adminHref(locale, `/admin/finance/refunds`)} backLabel="Daftar Refund"
      title={(
        <div className="space-y-1">
          <h1 className="m-0 flex flex-wrap items-center gap-2 text-xl font-semibold text-admin-ink">Refund {formatRupiah(Number(r.amount))} <Badge tone={status.tone}>{status.label}</Badge></h1>
          <p className="m-0 text-[12px] text-admin-muted">
            <Link href={adminHref(locale, `/admin/bookings/${r.booking.id}`)} className="font-mono font-semibold text-admin-accent hover:text-admin-accent-strong">{r.booking.bookingCode}</Link>
            {' · '}{r.booking.user.fullName} · {REFUND_SOURCE_LABEL[r.source]}
          </p>
        </div>
      )}
      main={(
        <>
          <ManageBox title="Ringkasan" icon="summary">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-2">
              <div><dt className="text-[11px] text-admin-muted">Jumlah refund</dt><dd className="m-0 font-semibold tabular-nums text-admin-ink">{formatRupiah(Number(r.amount))}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Sumber</dt><dd className="m-0 text-admin-ink">{REFUND_SOURCE_LABEL[r.source]}</dd></div>
              {r.source === 'cancellation' && <div><dt className="text-[11px] text-admin-muted">Force-majeure</dt><dd className="m-0 text-admin-ink">{r.forceMajeureCategory ? FORCE_MAJEURE_LABEL[r.forceMajeureCategory] : 'Bukan force-majeure'}</dd></div>}
              {facts && verdict && (
                <div><dt className="text-[11px] text-admin-muted">Persetujuan</dt><dd className="m-0 text-admin-ink">
                  {facts.policyCap === null ? 'Tanpa batas kebijakan' : `Batas kebijakan ${formatRupiah(facts.policyCap)}`}
                  {verdict.abovePolicy && <span className="font-semibold text-admin-warning"> · di atas kebijakan</span>}
                  {' · '}{verdict.needsSuperadmin ? <span className="font-semibold">wajib superadmin</span> : 'cukup manager'}
                </dd></div>
              )}
              <div className="sm:col-span-2"><dt className="text-[11px] text-admin-muted">Alasan (internal)</dt><dd className="m-0 break-words text-admin-ink">{r.reason}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Tagihan booking</dt><dd className="m-0 tabular-nums text-admin-ink">{formatRupiah(bill.grandTotal)}</dd></div>
              <div><dt className="text-[11px] text-admin-muted">Terbayar bersih (sesudah refund dibayar)</dt><dd className="m-0 tabular-nums text-admin-ink">{formatRupiah(bill.paid)}</dd></div>
              {(r.status === 'pending' || r.status === 'approved') && (
                <div className="sm:col-span-2"><dt className="text-[11px] text-admin-muted">Batas refund ini saat ini</dt><dd className="m-0 tabular-nums text-admin-ink">{formatRupiah(max)} {Number(r.amount) > max && <span className="font-semibold text-admin-danger">— melebihi batas (tagihan berubah); ubah jumlah atau tolak</span>}</dd></div>
              )}
            </dl>
          </ManageBox>
          <ManageBox title="Arus uang booking" icon="flow" description="Dari buku kas: semua uang masuk dan keluar untuk booking ini.">
            <DataTable columns={columns} rows={flows} getRowId={f => f.id} empty="Belum ada uang yang tercatat untuk booking ini." />
            <p className="m-0 text-right text-[12px] text-admin-muted">
              Masuk <span className="font-semibold tabular-nums text-admin-ink">{formatRupiah(totalIn)}</span> · Keluar <span className="font-semibold tabular-nums text-admin-ink">{formatRupiah(totalOut)}</span>
              {entries.length >= MAX_FLOW && ` · ${MAX_FLOW} entri pertama`}
            </p>
          </ManageBox>
          <ManageBox title="Rekening tujuan pelanggan" icon="recipient">
            {recipient
              ? <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-3">
                  <div><dt className="text-[11px] text-admin-muted">Bank</dt><dd className="m-0 text-admin-ink">{recipient.bank}</dd></div>
                  <div><dt className="text-[11px] text-admin-muted">Nomor rekening</dt><dd className="m-0 font-mono text-admin-ink">{recipient.accountNumber}</dd></div>
                  <div><dt className="text-[11px] text-admin-muted">Nama pemilik</dt><dd className="m-0 text-admin-ink">{recipient.accountName}</dd></div>
                </dl>
              : <p className="m-0 text-[12px] text-admin-muted">{r.status === 'paid' ? 'Dibayar tunai / tanpa rekening tercatat.' : 'Belum diisi — wajib sebelum dibayar (kecuali tunai).'}</p>}
          </ManageBox>
          <ManageBox title="Riwayat" icon="history">
            <ol className="m-0 list-none space-y-2 p-0">
              {steps.map(s => (
                <li key={s.label} className="text-[12px]">
                  <span className="font-semibold text-admin-ink">{s.label}</span>
                  <span className="text-admin-muted"> · {s.at ? fmt(s.at) : '—'} · {s.by}</span>
                  {s.note && <span className="block break-words text-admin-muted">{s.note}</span>}
                </li>
              ))}
            </ol>
          </ManageBox>
        </>
      )}
      sidebar={(
        <ManageBox title="Tindakan" icon="actions" collapsible={false} aside={<Badge tone={status.tone}>{status.label}</Badge>}>
          {canManage
            ? <RefundActions refundId={r.id} status={r.status} amount={Number(r.amount)} reason={r.reason} recipient={recipient} max={max}
                cancellation={r.source === 'cancellation'} forceMajeure={r.forceMajeureCategory} approveBlocked={approveBlocked}
                cashOptions={r.status === 'approved' ? await cashTargetOptions() : []} />
            : <p className="m-0 text-[12px] text-admin-muted">Hanya manager/superadmin yang dapat menyetujui atau membayar refund.</p>}
        </ManageBox>
      )}
    />
  )
}
