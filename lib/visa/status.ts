import { Prisma, type VisaStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { retryConflict } from '@/lib/booking/serializable'
import { isValidVisaStatusTransition, type VisaStatusChange } from '@/lib/validators/visaStatus'

// Penulis tunggal status visa per jamaah + riwayatnya (docs/arsitektur-visa.md §9): `visa_applications.status` dan `visa_status_events` (append-only) ditulis
// HANYA di sini, dalam SATU transaksi. Transisi dinilai di DALAM kunci baris pengajuan (menutup dua klik serentak yang dulu sama-sama lolos).
// Urutan kunci = urutan revisi booking: booking (FOR SHARE) → jamaah booking (FOR SHARE) → pengajuan visa (FOR UPDATE).

export type VisaStatusResult =
  | { kind: 'ok'; bookingId: string; bookingCode: string; userId: string; status: VisaStatus }
  | { kind: 'not_found' }
  | { kind: 'invalid_transition'; from: VisaStatus; to: VisaStatus }
  | { kind: 'not_verified' }

export async function changeVisaStatus(pilgrimId: string, input: VisaStatusChange, actorId: string): Promise<VisaStatusResult> {
  return retryConflict(() => prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT … FOR SHARE / FOR UPDATE.
    const pilgrim = await tx.bookingPilgrim.findUnique({ where: { id: pilgrimId }, select: { bookingId: true } })
    if (!pilgrim) return { kind: 'not_found' as const }
    const booking = await tx.$queryRaw<Array<{ bookingCode: string; userId: string }>>(Prisma.sql`SELECT "bookingCode", "userId" FROM "bookings" WHERE "id" = ${pilgrim.bookingId} FOR SHARE`)
    const held = await tx.$queryRaw<Array<{ reviewStatus: string }>>(Prisma.sql`SELECT "reviewStatus"::text AS "reviewStatus" FROM "booking_pilgrims" WHERE "id" = ${pilgrimId} FOR SHARE`)
    const app = await tx.$queryRaw<Array<{ id: string; status: VisaStatus }>>(Prisma.sql`SELECT "id", "status" FROM "visa_applications" WHERE "bookingPilgrimId" = ${pilgrimId} FOR UPDATE`)
    const b = booking[0]; const a = app[0]
    if (!b || !held[0] || !a) return { kind: 'not_found' as const }
    if (!isValidVisaStatusTransition(a.status, input.status)) return { kind: 'invalid_transition' as const, from: a.status, to: input.status }
    // Dikirim ke Syarikah hanya untuk data jamaah yang sudah diverifikasi petugas (docs/arsitektur-jamaah.md §8.4 butir 5, SEC-202).
    if (input.status === 'submitted_to_syarikah' && held[0].reviewStatus !== 'verified') return { kind: 'not_verified' as const }
    const changedAt = new Date()
    await tx.visaApplication.update({
      where: { id: a.id },
      data: {
        status: input.status,
        ...(input.notes ? { notes: input.notes } : {}),
        // Alasan tampil ke jamaah selama status Ditolak; dikosongkan begitu diproses ulang supaya tak tampil basi.
        rejectionReason: input.status === 'rejected' ? input.rejectionReason ?? null : null,
        ...(input.status === 'submitted_to_syarikah' ? { submittedAt: changedAt } : {}),
        ...(input.status === 'issued' ? { issuedAt: changedAt } : {}),
      },
      select: { id: true },
    })
    await tx.visaStatusEvent.create({ data: { visaApplicationId: a.id, fromStatus: a.status, toStatus: input.status, actorId, createdAt: changedAt }, select: { id: true } })
    return { kind: 'ok' as const, bookingId: pilgrim.bookingId, bookingCode: b.bookingCode, userId: b.userId, status: input.status }
  }))
}
