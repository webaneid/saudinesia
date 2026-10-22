import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { unusablePasswordHash } from '@/lib/auth/googleAccounts'
import { deleteObject as deleteStoredObject, deleteObjectsByPrefix } from '@/lib/storage/minio'
import { sweepErasedAccount } from '@/lib/account/erasureSweep'
import { sendEmail, type EmailInput, type EmailResult } from '@/lib/email/resend'
import { accountDeletedEmail, deletionRejectedEmail, deletionRequestedEmail } from '@/lib/email/accountTemplates'

// Penghapusan akun UU PDP (SEC-44) — docs/arsitektur-hapus-akun.md. ANONIMISASI, bukan hard delete: baris Booking/Payment/Refund
// dipertahankan (kewajiban pembukuan/pajak), data pribadi dihapus/diacak. Satu transaksi: kunci baris permintaan + pengguna, cek ulang syarat,
// hapus objek MinIO, ubah DB. Aman diulang. Tidak ada log yang memuat PII.

/** Booking yang masih berjalan — jamaah belum boleh dihapus (data dipakai memproses visa/transport/muthowif). */
export const NON_TERMINAL_BOOKING_STATUSES = ['awaiting_payment', 'payment_review', 'confirmed', 'active'] as const
const UNSETTLED_REFUND_STATUSES = ['pending', 'approved'] as const

/**
 * Masa tunggu antara pengajuan dan penghapusan permanen (DEL-02): pemegang sesi curian tidak bisa memicu penghapusan seketika, dan pemilik
 * sah punya waktu melihat email pengajuan lalu membatalkan. Penolakan boleh kapan saja; hanya `completed` yang menunggu.
 */
export const MIN_WAIT_HOURS = 72
export const earliestProcessAt = (requestedAt: Date) => new Date(requestedAt.getTime() + MIN_WAIT_HOURS * 3_600_000)

export type ErasureCounts = {
  bookings: number
  pilgrims: number
  documents: number
  visaApplications: number
  notifications: number
  authTokens: number
  groupMemberships: number
  address: number
}

export type DeletionDeps = {
  deleteObject: (key: string) => Promise<void>
  /** Sapuan per awalan `pilgrims/<id>/` (SEC-57) — menangkap berkas yang masuk terlambat. */
  deleteByPrefix: (prefix: string) => Promise<number>
  /** Batas tunggu sapuan segera (ms). Lewat batas: permintaan admin kembali, sapuan jalan terus di latar, cron harian menjamin. */
  sweepTimeoutMs?: number
  sendEmail: (input: EmailInput) => Promise<EmailResult>
}
const defaultDeps: DeletionDeps = { deleteObject: deleteStoredObject, deleteByPrefix: (prefix) => deleteObjectsByPrefix(prefix), sendEmail }

type Db = Prisma.TransactionClient

async function blockersFor(db: Db, userId: string, role: string, requestedAt: Date): Promise<string[]> {
  const blockers: string[] = []
  const earliest = earliestProcessAt(requestedAt)
  if (Date.now() < earliest.getTime()) blockers.push(`Masa tunggu ${MIN_WAIT_HOURS} jam belum lewat (paling cepat ${earliest.toISOString().slice(0, 16).replace('T', ' ')} UTC).`)
  if (role !== 'pilgrim') blockers.push('Akun bukan jamaah (staf/agen dikeluarkan dengan menonaktifkan akun, bukan lewat jalur UU PDP).')
  const active = await db.booking.count({ where: { userId, status: { in: [...NON_TERMINAL_BOOKING_STATUSES] } } })
  if (active > 0) blockers.push(`${active} booking masih berjalan (menunggu bayar / ditinjau / dikonfirmasi / aktif). Batalkan atau tunggu selesai.`)
  const refunds = await db.refund.count({ where: { booking: { userId }, status: { in: [...UNSETTLED_REFUND_STATUSES] } } })
  if (refunds > 0) blockers.push(`${refunds} refund belum tuntas (pending/disetujui).`)
  return blockers
}

async function countsFor(db: Db, userId: string, addressId: string | null): Promise<ErasureCounts> {
  const [bookings, pilgrims, documents, visaApplications, notifications, authTokens, groupMemberships] = await Promise.all([
    db.booking.count({ where: { userId } }),
    db.bookingPilgrim.count({ where: { booking: { userId } } }),
    db.document.count({ where: { pilgrim: { booking: { userId } } } }),
    db.visaApplication.count({ where: { pilgrim: { booking: { userId } } } }),
    db.notificationLog.count({ where: { userId } }),
    db.authToken.count({ where: { userId } }),
    db.groupMember.count({ where: { userId } }),
  ])
  return { bookings, pilgrims, documents, visaApplications, notifications, authTokens, groupMemberships, address: addressId ? 1 : 0 }
}

export type DeletionPreview =
  | { kind: 'not_found' }
  | { kind: 'not_pending'; status: string }
  | { kind: 'ok'; user: { id: string; fullName: string; email: string; role: string }; requestedAt: Date; eligible: boolean; blockers: string[]; willErase: ErasureCounts }

/** Baca saja (tanpa kunci) — untuk UI. Keputusan otoritatif diambil ulang di dalam transaksi executeDeletion. */
export async function previewDeletion(requestId: string): Promise<DeletionPreview> {
  const req = await prisma.accountDeletionRequest.findUnique({
    where: { id: requestId },
    select: { status: true, requestedAt: true, user: { select: { id: true, fullName: true, email: true, role: true, addressId: true } } },
  })
  if (!req) return { kind: 'not_found' }
  if (req.status !== 'pending') return { kind: 'not_pending', status: req.status }
  const { addressId, ...user } = req.user
  const blockers = await blockersFor(prisma, user.id, user.role, req.requestedAt)
  return { kind: 'ok', user, requestedAt: req.requestedAt, eligible: blockers.length === 0, blockers, willErase: await countsFor(prisma, user.id, addressId) }
}

export type ExecuteResult =
  | { ok: true; summary: ErasureCounts }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'confirm_mismatch' | 'storage_failed' }
  | { ok: false; reason: 'blocked'; blockers: string[] }

class Abort extends Error {
  constructor(readonly result: Exclude<ExecuteResult, { ok: true }>) { super('abort') }
}

const emailMatches = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Hapus objek paralel terbatas. Objek yang sudah tak ada BUKAN galat (MinIO removeObject idempoten). Satu gagal → lempar. */
async function deleteObjects(keys: string[], deps: DeletionDeps): Promise<void> {
  for (let i = 0; i < keys.length; i += 10) {
    const results = await Promise.allSettled(keys.slice(i, i + 10).map((k) => deps.deleteObject(k)))
    if (results.some((r) => r.status === 'rejected')) throw new Error('storage')
  }
}

export async function executeDeletion(
  requestId: string,
  processedById: string,
  input: { note?: string | null; confirmEmail: string },
  deps: DeletionDeps = defaultDeps,
): Promise<ExecuteResult> {
  // ── Tahap 0: cek murah tanpa kunci (jangan hapus berkas bila sudah pasti ditolak) ──
  const pre = await previewDeletion(requestId)
  if (pre.kind === 'not_found') return { ok: false, reason: 'not_found' }
  if (pre.kind === 'not_pending') return { ok: false, reason: 'not_pending' }
  if (!emailMatches(input.confirmEmail, pre.user.email)) return { ok: false, reason: 'confirm_mismatch' }
  if (!pre.eligible) return { ok: false, reason: 'blocked', blockers: pre.blockers }

  const userId = pre.user.id
  const passwordHash = await unusablePasswordHash() // mahal (bcrypt) — di luar transaksi

  // ── Satu transaksi. Urutan sengaja: kunci → cek ulang SEMUA syarat → BARU hapus objek MinIO → ubah DB. Dengan begitu tidak ada jalur
  //    abort (tolak paralel, blocker baru, konfirmasi salah) yang terjadi SETELAH berkas terhapus (DEL-03). Objek MinIO gagal → rollback
  //    total (akun kembali aktif), permintaan tetap pending, aman diulang. DB gagal sesudah objek terhapus → ulang: objek hilang bukan galat. ──
  let captured: { email: string; fullName: string }
  let summary: ErasureCounts
  try {
    const out = await prisma.$transaction(async (tx) => {
      // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kunci permintaan DAN pengguna menserialkan dua superadmin yang memproses
      // permintaan yang sama (juga pembatalan/penolakan paralel, yang menunggu kunci ini), dan memastikan syarat dicek pada keadaan yang diubah.
      const reqRows = await tx.$queryRaw<{ status: string; userId: string; requestedAt: Date }[]>`SELECT "status"::text AS "status", "userId", "requestedAt" FROM "account_deletion_requests" WHERE "id" = ${requestId} FOR UPDATE`
      const rq = reqRows[0]
      if (!rq) throw new Abort({ ok: false, reason: 'not_found' })
      if (rq.status !== 'pending') throw new Abort({ ok: false, reason: 'not_pending' })
      if (rq.userId !== userId) throw new Abort({ ok: false, reason: 'not_found' }) // defense-in-depth: userId tak pernah berubah, tapi dijaga

      const userRows = await tx.$queryRaw<{ role: string; email: string; fullName: string; addressId: string | null }[]>`SELECT "role"::text AS "role", "email", "fullName", "addressId" FROM "users" WHERE "id" = ${userId} FOR UPDATE`
      const u = userRows[0]
      if (!u) throw new Abort({ ok: false, reason: 'not_found' })
      // Akun yang SUDAH dianonimkan (mis. dua permintaan pending lama): tidak ada yang tersisa untuk dihapus dan alamatnya tak bisa dikirimi.
      if (u.email.startsWith('deleted-') && u.email.endsWith('@deleted.invalid')) throw new Abort({ ok: false, reason: 'not_pending' })
      if (!emailMatches(input.confirmEmail, u.email)) throw new Abort({ ok: false, reason: 'confirm_mismatch' })

      // Matikan akun DULU: memutus sesi (SEC-18) dan pembuatan booking baru sebelum syarat dicek ulang. Abort di bawah me-rollback ini.
      await tx.user.update({ where: { id: userId }, data: { isActive: false, sessionVersion: { increment: 1 } } })
      const blockers = await blockersFor(tx, userId, u.role, rq.requestedAt)
      if (blockers.length > 0) throw new Abort({ ok: false, reason: 'blocked', blockers })

      const counts = await countsFor(tx, userId, u.addressId)

      // Objek MinIO sekarang (syarat sudah final). Gagal → Abort → rollback.
      const docs = await tx.document.findMany({ where: { pilgrim: { booking: { userId } } }, select: { filePath: true } })
      try {
        await deleteObjects(docs.map((d) => d.filePath), deps)
      } catch {
        console.error(`[account-deletion] hapus objek penyimpanan gagal (${docs.length} berkas); dibatalkan, permintaan tetap pending`)
        throw new Abort({ ok: false, reason: 'storage_failed' })
      }
      await tx.document.deleteMany({ where: { pilgrim: { booking: { userId } } } })

      // Manifest jamaah pada booking pengguna: PII inti (paspor, KTP, tgl lahir, kontak) → kosong.
      await tx.bookingPilgrim.updateMany({ where: { booking: { userId } }, data: { fieldValues: {}, userId: null } })
      // Tautan akun pada manifest booking ORANG LAIN diputus saja; isi manifest itu milik pemesannya.
      await tx.bookingPilgrim.updateMany({ where: { userId, booking: { userId: { not: userId } } }, data: { userId: null } })
      // Teks bebas yang bisa memuat nama/nomor/alamat (DEL-01). Refund.reason hanya berisi string sistem (lib/booking/cancel.ts) → dibiarkan.
      await tx.visaApplication.updateMany({ where: { pilgrim: { booking: { userId } } }, data: { notes: null, rejectionReason: null } })
      await tx.booking.updateMany({ where: { userId }, data: { notes: null } })
      await tx.bookingTransport.updateMany({ where: { booking: { userId } }, data: { pickupDetail: null, dropoffDetail: null } })
      await tx.payment.updateMany({ where: { booking: { userId } }, data: { notes: null } })
      await tx.refund.updateMany({ where: { booking: { userId } }, data: { notes: null } })
      await tx.groupMember.updateMany({ where: { userId }, data: { userId: null, inviteToken: null } })
      // Baris log dipertahankan untuk audit pengiriman; penerima & isi pesan tidak.
      await tx.notificationLog.updateMany({ where: { userId }, data: { recipient: '[dihapus]', messagePreview: null, error: null } })
      await tx.authToken.deleteMany({ where: { OR: [{ userId }, { email: u.email }] } })

      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.invalid`,
          fullName: 'Akun Dihapus',
          phone: null, whatsapp: null, whatsappVerifiedAt: null, verifiedWhatsapp: null, googleSub: null,
          passwordHash,
          addressId: null,
          sessionVersion: { increment: 1 }, // aturan CLAUDE.md: penulis passwordHash menaikkan versi di write yang SAMA (sesi sudah mati sejak langkah pertama)
        },
      })
      if (u.addressId) await tx.address.delete({ where: { id: u.addressId } })

      await tx.accountDeletionRequest.update({
        where: { id: requestId },
        data: { status: 'completed', note: input.note ?? null, processedAt: new Date(), processedById, erasureSummary: counts },
      })
      return { captured: { email: u.email, fullName: u.fullName }, summary: counts }
    }, { timeout: 60_000, maxWait: 10_000 })
    captured = out.captured; summary = out.summary
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }

  // Pemberitahuan ke subjek data (alamat asli, tidak disimpan di mana pun). Gagal kirim tidak membatalkan penghapusan.
  const mail = accountDeletedEmail(captured.fullName)
  const sent = await deps.sendEmail({ to: captured.email, subject: mail.subject, html: mail.html, text: mail.text })
  if (sent.status === 'failed') console.error('[account-deletion] email konfirmasi gagal terkirim')

  // Sapuan segera (SEC-57): berkas yang sedang diunggah / log notifikasi yang sedang terbang saat commit. Yang masih lolos disapu cron harian
  // (lib/cron/erasureSweepJob.ts, jendela 7 hari). Gagal tidak membatalkan apa pun — penghapusan sudah final.
  // Dibatasi waktu (S57-LOW3): MinIO yang menggantung / booking grup besar tak boleh membuat request superadmin menunggu (504 di proxy) —
  // penghapusan sudah final; yang tersisa dijamin cron harian.
  const sweep = sweepErasedAccount(userId, { deleteByPrefix: deps.deleteByPrefix }).catch((e) => {
    console.error('[account-deletion] sapuan awal gagal; cron harian akan mengulang:', e instanceof Error ? e.name : e)
  })
  await Promise.race([sweep, new Promise<void>((resolve) => setTimeout(resolve, deps.sweepTimeoutMs ?? 10_000).unref())])
  return { ok: true, summary }
}

export type RejectResult = { ok: true } | { ok: false; reason: 'not_found' | 'not_pending' }

export async function rejectDeletion(requestId: string, processedById: string, note: string | null, deps: DeletionDeps = defaultDeps): Promise<RejectResult> {
  const req = await prisma.accountDeletionRequest.findUnique({ where: { id: requestId }, select: { user: { select: { email: true, fullName: true } } } })
  if (!req) return { ok: false, reason: 'not_found' }
  // Klaim atomik: hanya satu pemanggil yang memindahkan pending → rejected.
  const claimed = await prisma.accountDeletionRequest.updateMany({
    where: { id: requestId, status: 'pending' },
    data: { status: 'rejected', note, processedAt: new Date(), processedById },
  })
  if (claimed.count === 0) return { ok: false, reason: 'not_pending' }

  const mail = deletionRejectedEmail(req.user.fullName, note)
  const sent = await deps.sendEmail({ to: req.user.email, subject: mail.subject, html: mail.html, text: mail.text })
  if (sent.status === 'failed') console.error('[account-deletion] email penolakan gagal terkirim')
  return { ok: true }
}

export type SubmitResult =
  | { ok: true; request: { status: string; requestedAt: Date } }
  | { ok: false; reason: 'gone' | 'pending_exists' }

/**
 * Pengajuan oleh pemilik akun. Cek-lalu-buat diserialkan per pengguna lewat kunci baris: dua POST paralel tidak melahirkan dua permintaan
 * pending (DEL-06). Pemilik diberi tahu lewat email SEKARANG, bukan hanya saat selesai: sesi curian tak bisa mengajukan diam-diam (DEL-02).
 */
export async function submitDeletionRequest(userId: string, deps: Pick<DeletionDeps, 'sendEmail'> = defaultDeps): Promise<SubmitResult> {
  const created = await prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE.
    const rows = await tx.$queryRaw<{ email: string; fullName: string }[]>`SELECT "email", "fullName" FROM "users" WHERE "id" = ${userId} FOR UPDATE`
    const u = rows[0]
    if (!u) return { kind: 'gone' as const }
    const pending = await tx.accountDeletionRequest.findFirst({ where: { userId, status: 'pending' }, select: { id: true } })
    if (pending) return { kind: 'pending_exists' as const }
    const request = await tx.accountDeletionRequest.create({ data: { userId }, select: { status: true, requestedAt: true } })
    return { kind: 'created' as const, request, user: u }
  })
  if (created.kind !== 'created') return { ok: false, reason: created.kind }

  const mail = deletionRequestedEmail(created.user.fullName, MIN_WAIT_HOURS)
  const sent = await deps.sendEmail({ to: created.user.email, subject: mail.subject, html: mail.html, text: mail.text })
  if (sent.status === 'failed') console.error('[account-deletion] email pengajuan gagal terkirim')
  return { ok: true, request: created.request }
}

/** Menarik permintaan pending milik pengguna. Klaim atomik: menunggu kunci baris bila pemrosesan sedang berjalan, lalu melihat `completed` → gagal. */
export async function withdrawDeletionRequest(userId: string): Promise<boolean> {
  const r = await prisma.accountDeletionRequest.updateMany({ where: { userId, status: 'pending' }, data: { status: 'withdrawn', processedAt: new Date() } })
  return r.count > 0
}
