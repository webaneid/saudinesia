// Jejak keamanan staf (docs/rencana-audit-golive.md §6, SEC-304). SATU-SATUNYA penulis `staff_audit_events` (tabel append-only, trigger DB) dan
// pembacanya untuk halaman Sistem → Jejak Staf. Ringkasan TANPA data pribadi: hanya peran/status, kode alasan, jumlah — nama/email/nomor tak pernah
// masuk (tipe `StaffAuditSummary` sengaja sempit). IP = alamat klien (keputusan pemilik: utuh, hanya untuk aksi/login staf).
import type { Prisma, PrismaClient, UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ADMIN_ROLES } from '@/lib/auth/roles'
import { visibleStaffWhere, type AdminActor } from '@/lib/auth/adminUsers'

/** Sama dengan CHECK `staff_audit_events_action_check` di migrasi. */
export const STAFF_AUDIT_ACTIONS = ['staff_create', 'staff_update', 'staff_reset_limits', 'staff_whatsapp_release', 'login_success', 'login_failed', 'documents_zip'] as const
export type StaffAuditAction = (typeof STAFF_AUDIT_ACTIONS)[number]

export const STAFF_AUDIT_LABEL: Record<StaffAuditAction, string> = {
  staff_create: 'Buat akun staf',
  staff_update: 'Ubah akun staf',
  staff_reset_limits: 'Buka kunci login',
  staff_whatsapp_release: 'Lepas verifikasi WhatsApp',
  login_success: 'Login berhasil',
  login_failed: 'Login gagal',
  documents_zip: 'Unduh ZIP dokumen jamaah',
}

type Scalar = string | number | boolean | null
/** Nilai ringkasan: skalar atau pasangan [lama, baru]. Jangan isi nama/email/nomor. */
export type StaffAuditSummary = Record<string, Scalar | [Scalar, Scalar]>

export type StaffAuditInput = {
  action: StaffAuditAction
  actorId: string | null
  targetUserId?: string | null
  bookingId?: string | null
  ip?: string | null
  summary?: StaffAuditSummary
}

type Db = Prisma.TransactionClient | PrismaClient

/** Tulis satu baris jejak. Di jalur perubahan: panggil DI DALAM transaksi perubahan (jejak gagal = perubahan batal). */
export async function recordStaffEvent(db: Db, e: StaffAuditInput): Promise<void> {
  await db.staffAuditEvent.create({
    data: {
      action: e.action,
      actorId: e.actorId,
      targetUserId: e.targetUserId ?? null,
      bookingId: e.bookingId ?? null,
      ip: e.ip ? e.ip.slice(0, 64) : null,
      summary: (e.summary ?? {}) as Prisma.InputJsonObject,
    },
  })
}

/**
 * IP klien UTUH untuk jejak (keputusan pemilik) — BUKAN `clientIp` rate limit, yang meringkas IPv6 menjadi blok /64. Nilai pertama
 * `X-Forwarded-For` (ditimpa Caddy di depan aplikasi), hanya bila berbentuk alamat IP.
 */
export function auditIp(request: Request): string | null {
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first && /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : null
}

/** Peran staf (yang login-nya dicatat). Jamaah/agen tidak (keputusan pemilik). */
export const isStaffRole = (role: UserRole): boolean => ADMIN_ROLES.includes(role)

export type StaffAuditFilter = { action?: StaffAuditAction; staffId?: string }
export type StaffAuditRow = {
  id: string
  at: Date
  action: StaffAuditAction
  actor: { id: string; fullName: string; role: UserRole } | null
  target: { id: string; fullName: string; role: UserRole } | null
  booking: { id: string; bookingCode: string } | null
  ip: string | null
  summary: StaffAuditSummary
}

/**
 * Filter Prisma untuk penampil: akun bayangan Platform Provider tak terlihat oleh superadmin klien (sama dengan `visibleStaffWhere`) — kejadian yang
 * pelaku ATAU targetnya akun provider disembunyikan. `staffId` = pelaku atau target.
 */
async function visibleWhere(viewer: AdminActor, filter: StaffAuditFilter, db: Db): Promise<Prisma.StaffAuditEventWhereInput> {
  const and: Prisma.StaffAuditEventWhereInput[] = []
  if (viewer !== null && !viewer.isPlatformProvider) {
    const hidden = (await db.user.findMany({ where: { isPlatformProvider: true }, select: { id: true } })).map((u) => u.id)
    if (hidden.length) {
      and.push({ OR: [{ actorId: null }, { actorId: { notIn: hidden } }] })
      and.push({ OR: [{ targetUserId: null }, { targetUserId: { notIn: hidden } }] })
    }
  }
  if (filter.action) and.push({ action: filter.action })
  if (filter.staffId) and.push({ OR: [{ actorId: filter.staffId }, { targetUserId: filter.staffId }] })
  return and.length ? { AND: and } : {}
}

export async function countStaffEvents(viewer: AdminActor, filter: StaffAuditFilter, db: Db = prisma): Promise<number> {
  return db.staffAuditEvent.count({ where: await visibleWhere(viewer, filter, db) })
}

export async function listStaffEvents(viewer: AdminActor, filter: StaffAuditFilter, range: { skip: number; take: number }, db: Db = prisma): Promise<StaffAuditRow[]> {
  const rows = await db.staffAuditEvent.findMany({
    where: await visibleWhere(viewer, filter, db),
    orderBy: [{ at: 'desc' }, { id: 'desc' }],
    ...range,
  })
  const userIds = [...new Set(rows.flatMap((r) => [r.actorId, r.targetUserId]).filter((x): x is string => x !== null))]
  const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((x): x is string => x !== null))]
  const [users, bookings] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, role: true } }) : [],
    bookingIds.length ? db.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, bookingCode: true } }) : [],
  ])
  const u = new Map(users.map((x) => [x.id, x]))
  const b = new Map(bookings.map((x) => [x.id, x]))
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action as StaffAuditAction,
    actor: r.actorId ? u.get(r.actorId) ?? null : null,
    target: r.targetUserId ? u.get(r.targetUserId) ?? null : null,
    booking: r.bookingId ? b.get(r.bookingId) ?? null : null,
    ip: r.ip,
    summary: (r.summary ?? {}) as StaffAuditSummary,
  }))
}

/** Pilihan filter staf: akun staf yang terlihat penampil. */
export async function staffFilterOptions(viewer: AdminActor, db: Db = prisma): Promise<{ id: string; fullName: string }[]> {
  return db.user.findMany({
    where: { role: { in: ADMIN_ROLES }, ...visibleStaffWhere(viewer) },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
    select: { id: true, fullName: true },
    take: 500,
  })
}
