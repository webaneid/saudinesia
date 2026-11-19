import Link from 'next/link'
import { redirect } from 'next/navigation'
import { buildListHref, paginate, parseListParams } from '@/lib/admin/pagination'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { Badge, type BadgeTone } from '@/components/admin/ui/Badge'
import { DataTable, type Column } from '@/components/admin/data-table/DataTable'
import { FilterBar } from '@/components/admin/data-table/FilterBar'
import { FilterSelect } from '@/components/admin/data-table/FilterSelect'
import { Pagination } from '@/components/admin/data-table/Pagination'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { safeLocale } from '@/lib/utils/locale'
import { DATETIME_MEDIUM, formatInstant } from '@/lib/time'
import {
  STAFF_AUDIT_ACTIONS, STAFF_AUDIT_LABEL, countStaffEvents, listStaffEvents, staffFilterOptions,
  type StaffAuditAction, type StaffAuditRow, type StaffAuditSummary,
} from '@/lib/audit/staff'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TONE: Record<StaffAuditAction, BadgeTone> = {
  staff_create: 'accent', staff_update: 'accent', staff_reset_limits: 'warning', staff_whatsapp_release: 'warning',
  login_success: 'ok', login_failed: 'danger', documents_zip: 'neutral',
}
const ROLE_LABEL: Record<string, string> = { pilgrim: 'jamaah', agent: 'agen', admin: 'admin', manager: 'manager', superadmin: 'superadmin' }
const REASON_LABEL: Record<string, string> = { password: 'sandi salah', inactive: 'akun nonaktif', unverified: 'email belum terverifikasi' }
const FIELD_LABEL: Record<string, string> = { role: 'peran', isActive: 'aktif', fullName: 'nama', cleared: 'kunci dibuka', released: 'dilepas', files: 'berkas', pilgrims: 'jamaah', reason: 'alasan' }

const fmt = (k: string, v: unknown): string => {
  if (typeof v === 'boolean') return v ? 'ya' : 'tidak'
  if (k === 'role' && typeof v === 'string') return ROLE_LABEL[v] ?? v
  if (k === 'reason' && typeof v === 'string') return REASON_LABEL[v] ?? v
  return v === null ? '—' : String(v)
}
const summaryText = (s: StaffAuditSummary): string =>
  Object.entries(s).map(([k, v]) => `${FIELD_LABEL[k] ?? k}: ${Array.isArray(v) ? `${fmt(k, v[0])} → ${fmt(k, v[1])}` : fmt(k, v)}`).join(' · ') || '—'

const person = (p: StaffAuditRow['actor']) => (p ? <span className="text-[13px]">{p.fullName} <span className="text-admin-muted">({ROLE_LABEL[p.role] ?? p.role})</span></span> : <span className="text-admin-muted">—</span>)

export default async function StaffAuditPage({ params, searchParams }: Props) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(`/${safeLocale(locale)}/admin`)
  const sp = await searchParams
  const list = parseListParams(sp)

  const staff = await staffFilterOptions(session)
  const action = typeof sp.action === 'string' && (STAFF_AUDIT_ACTIONS as readonly string[]).includes(sp.action) ? (sp.action as StaffAuditAction) : undefined
  // Daftar putih: hanya staf yang terlihat penampil (akun bayangan Platform Provider tak bisa dipilih lewat URL).
  const staffId = typeof sp.staff === 'string' && staff.some(s => s.id === sp.staff) ? sp.staff : undefined
  const filter = { action, staffId }

  const { items, meta } = await paginate<StaffAuditRow>(
    list,
    () => countStaffEvents(session, filter),
    range => listStaffEvents(session, filter, range),
  )

  const columns: Column<StaffAuditRow>[] = [
    { key: 'at', header: 'Waktu', cell: r => <span className="text-[12px] text-admin-muted">{formatInstant(r.at, DATETIME_MEDIUM)}</span> },
    { key: 'action', header: 'Aksi', mobile: 'title', cell: r => <Badge tone={TONE[r.action] ?? 'neutral'}>{STAFF_AUDIT_LABEL[r.action] ?? r.action}</Badge> },
    { key: 'actor', header: 'Pelaku', cell: r => person(r.actor) },
    {
      key: 'target', header: 'Sasaran',
      cell: r => r.booking
        ? <Link href={`/${locale}/admin/bookings/${r.booking.id}`} className="text-[13px] text-admin-accent hover:underline">{r.booking.bookingCode}</Link>
        : r.target && r.target.id !== r.actor?.id ? person(r.target) : <span className="text-admin-muted">—</span>,
    },
    { key: 'detail', header: 'Rincian', cell: r => <span className="text-[12px] text-admin-muted">{summaryText(r.summary)}</span> },
    { key: 'ip', header: 'IP', cell: r => <span className="font-mono text-[12px] text-admin-muted">{r.ip ?? '—'}</span> },
  ]

  const base = `/${locale}/admin/system/staff-audit`
  const limitParam = sp.limit === undefined ? undefined : String(list.limit)
  const hrefFor = (page: number) => buildListHref(base, { action, staff: staffId, page, limit: limitParam })

  return (
    <div className="space-y-5">
      <PageHeader title="Jejak Staf" description="Catatan permanen: akun staf dibuat/diubah, buka kunci login, lepas WhatsApp, login staf, dan unduhan ZIP dokumen jamaah. Tidak bisa diubah atau dihapus." />
      <FilterBar active={Boolean(action || staffId)} resetHref={buildListHref(base, { limit: limitParam })}>
        <FilterSelect label="Aksi" value={action ?? ''} options={STAFF_AUDIT_ACTIONS.map(v => ({ value: v, label: STAFF_AUDIT_LABEL[v] }))} nav={{ base, param: 'action', query: { staff: staffId, limit: limitParam } }} />
        <FilterSelect label="Staf" value={staffId ?? ''} options={staff.map(s => ({ value: s.id, label: s.fullName }))} nav={{ base, param: 'staff', query: { action, limit: limitParam } }} />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={items}
        getRowId={r => r.id}
        empty="Belum ada jejak."
        footer={meta.total > 0 ? <Pagination {...meta} hrefFor={hrefFor} /> : undefined}
      />
    </div>
  )
}
