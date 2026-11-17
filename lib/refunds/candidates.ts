import type { Prisma } from '@prisma/client'
import { escapeLike } from '@/lib/utils/search'
import { refundableOf } from '@/lib/refunds/service'

export type RefundCandidate = { id: string; code: string; customer: string; status: string; paid: number; max: number }

/**
 * Booking yang bisa direfund (pemilih "Buat Refund", §10.13): cari kode booking / nama pelanggan (atau `id` tepat), hanya yang ada uang terkonfirmasi, batas
 * dihitung `refundableOf` (sama dengan yang dinilai ulang di dalam kunci saat menyimpan — angka ini hanya pratinjau). Maksimal 10.
 */
export async function refundCandidates(db: Prisma.TransactionClient, input: { q?: string; id?: string }): Promise<RefundCandidate[]> {
  const q = input.q?.trim()
  const rows = await db.booking.findMany({
    where: {
      status: { not: 'draft' },
      payments: { some: { status: 'confirmed' } },
      ...(input.id ? { id: input.id } : q ? { OR: [{ bookingCode: { contains: escapeLike(q), mode: 'insensitive' } }, { user: { fullName: { contains: escapeLike(q), mode: 'insensitive' } } }] } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.id ? 1 : 25,
    select: { id: true, bookingCode: true, status: true, user: { select: { fullName: true } } },
  })
  const out: RefundCandidate[] = []
  for (const b of rows) {
    const r = await refundableOf(db, b.id)
    if (r.max > 0) out.push({ id: b.id, code: b.bookingCode, customer: b.user.fullName, status: b.status, paid: r.paid, max: r.max })
    if (out.length >= 10) break
  }
  return out
}
