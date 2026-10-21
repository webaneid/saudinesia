import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { Pagination } from '@/components/admin/data-table/Pagination'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

type LogRow = Prisma.NotificationLogGetPayload<{ include: { user: { select: { fullName: true; phone: true } } } }>

// 'sent' = diterima penyedia (bukan jaminan sampai); 'skipped' = kanal belum dikonfigurasi/dimatikan; 'failed' = ditolak/galat.
const STATUS_TONE: Record<string, BadgeTone> = { sent: 'ok', skipped: 'warning', failed: 'danger' }
const STATUS_LABEL: Record<string, string> = { sent: 'terkirim', skipped: 'dilewati', failed: 'gagal' }

const columns: Column<LogRow>[] = [
  { key: 'time', header: 'Waktu', cell: l => <span className="text-[12px] text-admin-muted">{new Date(l.sentAt).toLocaleString('id-ID')}</span> },
  { key: 'user', header: 'User', mobile: 'title', cell: l => <span className="text-[13px]">{l.user.fullName ?? l.recipient}</span> },
  { key: 'channel', header: 'Kanal', cell: l => <Badge tone={l.channel === 'whatsapp' ? 'ok' : 'accent'}>{l.channel}</Badge> },
  { key: 'type', header: 'Tipe', cell: l => <span className="text-[12px] text-admin-muted">{l.type.replace(/_/g, ' ')}</span> },
  { key: 'status', header: 'Status', cell: l => <Badge tone={STATUS_TONE[l.status] ?? 'neutral'}>{STATUS_LABEL[l.status] ?? l.status}</Badge> },
  { key: 'detail', header: 'Keterangan', cell: l => <span className="text-[12px] text-admin-muted">{l.error ?? '—'}</span> },
]

export default async function AdminNotifications({ params, searchParams }: Props) {
  const { locale } = await params
  const sp = await searchParams
  const list = parseListParams(sp)

  const { items: logs, meta } = await paginate<LogRow>(
    list,
    () => prisma.notificationLog.count(),
    range => prisma.notificationLog.findMany({
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }], // id = tie-breaker: sentAt bisa kembar, halaman harus stabil
      ...range,
      include: { user: { select: { fullName: true, phone: true } } },
    }),
  )

  const hrefFor = (page: number) =>
    buildListHref(`/${locale}/admin/notifications`, { page, limit: sp.limit === undefined ? undefined : list.limit })

  return (
    <div className="space-y-5">
      <PageHeader title="Log Notifikasi" />
      <DataTable
        columns={columns}
        rows={logs}
        getRowId={l => l.id}
        empty="Belum ada log."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={hrefFor} /> : undefined}
      />
    </div>
  )
}
