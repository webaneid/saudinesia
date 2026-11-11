import { Prisma, type PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { completeness, validateFieldValues, type Completeness } from '@/lib/manifest/values'
import { cardBoundKeys } from '@/lib/manifest/roles'
import { resolveAddressValues } from '@/lib/manifest/address'
import { isDeletedAccount } from '@/lib/customers/query'
import { isReviewLocked, REVIEW_LOCKED_MESSAGE } from '@/lib/pilgrims/reviewState'
import type { ServiceError } from './service'

// Isian TAMBAHAN jamaah booking oleh PEMESAN sendiri (audit front-end 2026-11-11, docs/arsitektur-frontend-publik.md §8): kolom manifest produk
// yang TIDAK terikat peran kartu (mis. "Nomor HP Host", "Short Address" pada visa tertentu). Sebelumnya hanya petugas yang bisa mengisinya,
// padahal checkout tidak lagi mengumpulkan data jamaah — pemesan tak pernah bisa mengajukan jamaahnya untuk diperiksa.
//
// Batas sengaja: kolom berperan (nama, NIK, paspor, kontak, …) TETAP hanya dari kartu Jamaah Saya lewat `linkCard` — di sini ditolak 400, jadi
// tak ada jalur pemesan untuk menyegel/mengubah NIK/paspor tanpa kartu. Urutan kunci sama dengan route admin dan lib/pilgrims/bookingLink.ts:
// pemilik `FOR SHARE` → jamaah booking `FOR UPDATE`; data yang sedang/sudah diperiksa (`submitted|verified`) terkunci (409).

export type ExtraFieldsResult = { ok: true; completeness: Completeness } | ServiceError

const fail = (status: ServiceError['status'], error: string, field?: string): ServiceError => ({ ok: false, status, error, ...(field ? { field } : {}) })

/** Simpan kolom non-kartu satu jamaah di booking AKTIF milik `userId`. Booking/jamaah akun lain → 404 sama dengan "tidak ada". */
export async function saveExtraFields(userId: string, bookingId: string, pilgrimId: string, input: Record<string, unknown>): Promise<ExtraFieldsResult> {
  const pilgrim = await prisma.bookingPilgrim.findFirst({
    where: { id: pilgrimId, bookingId, booking: { userId, status: { not: 'draft' } } },
    select: { visaApplication: { select: { visaProductId: true } }, booking: { select: { status: true } } },
  })
  if (!pilgrim) return fail(404, 'Data jamaah tidak ditemukan')
  if (pilgrim.booking.status !== 'active') return fail(409, 'Booking ini sudah tidak aktif — data dan dokumen tidak dapat ditambah lagi')

  const fields = pilgrim.visaApplication?.visaProductId
    ? await getManifestFieldRequirements('visa', pilgrim.visaApplication.visaProductId)
    : await getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID)
  const bound = new Set(cardBoundKeys(fields))
  const known = new Set(fields.map(f => f.fieldKey))
  for (const key of Object.keys(input)) {
    if (!known.has(key)) return fail(400, 'Kolom tidak dikenal', key)
    if (bound.has(key)) return fail(400, 'Kolom ini diisi dari data Jamaah Saya — ubah lewat "Ubah data jamaah"', key)
  }
  const extra = fields.filter(f => !bound.has(f.fieldKey))
  const checked = validateFieldValues(extra, input)
  if (!checked.ok) { const [k, m] = Object.entries(checked.errors)[0] ?? []; return fail(400, m ?? 'Data tidak valid', k) }
  const addressed = await resolveAddressValues(extra, checked.values)
  if (!addressed.ok) { const [k, m] = Object.entries(addressed.errors)[0] ?? []; return fail(400, m ?? 'Alamat tidak valid', k) }

  return prisma.$transaction(async (tx): Promise<ExtraFieldsResult> => {
    // $queryRaw: ORM tak punya FOR SHARE/FOR UPDATE.
    const owner = await tx.$queryRaw<Array<{ email: string }>>(Prisma.sql`SELECT "email" FROM "users" WHERE "id" = ${userId} FOR SHARE`)
    if (!owner[0] || isDeletedAccount(owner[0].email)) return fail(404, 'Data jamaah tidak ditemukan')
    const locked = await tx.$queryRaw<Array<{ fieldValues: unknown; reviewStatus: PilgrimReviewStatus; status: string }>>(Prisma.sql`
      SELECT bp."fieldValues", bp."reviewStatus", b."status"::text AS "status"
      FROM "booking_pilgrims" bp JOIN "bookings" b ON b."id" = bp."bookingId"
      WHERE bp."id" = ${pilgrimId} AND bp."bookingId" = ${bookingId} AND b."userId" = ${userId}
      FOR UPDATE OF bp`)
    const row = locked[0]
    if (!row) return fail(404, 'Data jamaah tidak ditemukan')
    if (row.status !== 'active') return fail(409, 'Booking ini sudah tidak aktif — data dan dokumen tidak dapat ditambah lagi')
    if (isReviewLocked(row.reviewStatus)) return fail(409, REVIEW_LOCKED_MESSAGE)
    const merged = { ...((row.fieldValues ?? {}) as Record<string, unknown>), ...addressed.values }
    await tx.bookingPilgrim.update({ where: { id: pilgrimId }, data: { fieldValues: merged as Prisma.InputJsonValue }, select: { id: true } })
    return { ok: true, completeness: completeness(fields, merged) }
  })
}
