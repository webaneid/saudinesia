import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma, type PilgrimReviewStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ok, err, boundedKeys } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { completeness, validateFieldValues } from '@/lib/manifest/values'
import { dbDateOf } from '@/lib/time'
import { authFailureResponse } from '@/lib/admin/errors'
import { isDeletedAccount } from '@/lib/customers/query'
import { passportCountryOf, sealManualPii } from '@/lib/pilgrims/bookingLink'
import { isSealedRole } from '@/lib/manifest/roles'
import { resolveAddressValues } from '@/lib/manifest/address'
import { isReviewLocked, REVIEW_LOCKED_MESSAGE } from '@/lib/pilgrims/reviewState'

class Refused extends Error {}

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }
const schema = z.object({
  fieldValues: boundedKeys(50, 'Terlalu banyak field', z.record(z.string().max(64), z.unknown())),
  plannedTravelDate: z.string().date().nullable().optional(),
}).strict()

// Isi data jamaah oleh admin (docs/arsitektur-booking-engine-v2.md §10.3, D3): nilai divalidasi bentuknya per definisi field produk visa jamaah (atau `core`);
// field kosong boleh (dilanjutkan nanti) — kelengkapan dikembalikan untuk indikator. Draf tak punya jamaah; booking lain (aktif/selesai/batal) boleh dikoreksi.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id, pilgrimId } = await params
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const pilgrim = await prisma.bookingPilgrim.findFirst({
      where: { id: pilgrimId, bookingId: id, booking: { status: { not: 'draft' } } },
      select: {
        visaApplication: { select: { id: true, visaProductId: true } }, booking: { select: { userId: true, status: true, user: { select: { email: true } } } },
        savedPilgrim: { select: { nationality: true } },
      },
    })
    if (!pilgrim) return NextResponse.json(err('Jamaah tidak ditemukan'), { status: 404 })
    // Akun yang sudah dihapus (UU PDP): data pribadi jamaah di booking-nya tak boleh diisi lagi.
    if (isDeletedAccount(pilgrim.booking.user.email)) return NextResponse.json(err('Akun pelanggan ini sudah dihapus'), { status: 409 })
    const fields = pilgrim.visaApplication?.visaProductId
      ? await getManifestFieldRequirements('visa', pilgrim.visaApplication.visaProductId)
      : await getManifestFieldRequirements(CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID)
    const checked = validateFieldValues(fields, parsed.data.fieldValues)
    if (!checked.ok) return NextResponse.json({ success: false, error: Object.values(checked.errors)[0], meta: { errors: checked.errors } }, { status: 400 })
    if (parsed.data.plannedTravelDate !== undefined && !pilgrim.visaApplication) return NextResponse.json(err('Jamaah ini tidak mengajukan visa'), { status: 400 })
    // NIK / nomor paspor (peran `nik`/`passport_number`) DISEGEL — snapshot hanya menyimpan samaran (docs/arsitektur-jamaah.md §5.3 butir 3).
    // Alamat berjenjang dibekukan dengan `text` dari nama wilayah di DB (D1, docs/arsitektur-jamaah.md §5.5).
    const addressed = await resolveAddressValues(fields, checked.values)
    if (!addressed.ok) return NextResponse.json({ success: false, error: Object.values(addressed.errors)[0], meta: { errors: addressed.errors } }, { status: 400 })
    const sealed = await sealManualPii(fields, addressed.values, passportCountryOf(fields, addressed.values, pilgrim.savedPilgrim?.nationality))
    if (!sealed.ok) return NextResponse.json({ success: false, error: Object.values(sealed.errors)[0], meta: { errors: sealed.errors } }, { status: 400 })

    const values = await prisma.$transaction(async (tx) => {
      // Urutan kunci sama dengan lib/pilgrims/bookingLink.ts: pemilik (FOR SHARE, cek ulang terhapus — kolom segel tak boleh mendarat sesudah
      // anonimisasi) → jamaah booking (FOR UPDATE: dua admin yang menyimpan field berbeda tak saling menimpa). $queryRaw: ORM tak punya FOR SHARE/UPDATE.
      const owner = await tx.$queryRaw<Array<{ email: string }>>(Prisma.sql`SELECT "email" FROM "users" WHERE "id" = ${pilgrim.booking.userId} FOR SHARE`)
      if (!owner[0] || isDeletedAccount(owner[0].email)) throw new Refused('Akun pelanggan ini sudah dihapus')
      const locked = await tx.$queryRaw<Array<{ fieldValues: unknown; savedPilgrimId: string | null; reviewStatus: PilgrimReviewStatus }>>(Prisma.sql`SELECT "fieldValues", "savedPilgrimId", "reviewStatus" FROM "booking_pilgrims" WHERE "id" = ${pilgrimId} FOR UPDATE`)
      // Diajukan/terverifikasi pada booking aktif (Fase 6): data yang sedang/sudah diperiksa tak berubah diam-diam — kembalikan dulu.
      if (locked[0] && pilgrim.booking.status === 'active' && isReviewLocked(locked[0].reviewStatus)) throw new Refused(REVIEW_LOCKED_MESSAGE)
      // NIK/paspor jamaah bertaut berasal dari kartu (identitas orang di kartu) — mengetik nilai lain di sini akan mencampur dua orang.
      const current = (locked[0]?.fieldValues ?? {}) as Record<string, unknown>
      const blank = (v: unknown) => (v === '' || v === undefined ? null : v)
      const changesSealed = fields.some(f => isSealedRole(f.role) && f.fieldKey in checked.values && blank(checked.values[f.fieldKey]) !== blank(current[f.fieldKey]))
      if (locked[0]?.savedPilgrimId && changesSealed) {
        throw new Refused('NIK/paspor jamaah ini berasal dari data jamaah tersimpan — ubah di data tersimpan lalu perbarui dari kartu, atau lepas tautan dulu')
      }
      const merged = { ...current, ...sealed.values }
      await tx.bookingPilgrim.update({ where: { id: pilgrimId }, data: { fieldValues: merged as Prisma.InputJsonValue, ...sealed.columns }, select: { id: true } })
      if (parsed.data.plannedTravelDate !== undefined && pilgrim.visaApplication) {
        await tx.visaApplication.update({ where: { id: pilgrim.visaApplication.id }, data: { plannedTravelDate: parsed.data.plannedTravelDate ? dbDateOf(parsed.data.plannedTravelDate) : null } })
      }
      return merged
    })
    return NextResponse.json(ok({ completeness: completeness(fields, values) }))
  } catch (e) {
    if (e instanceof Refused) return NextResponse.json(err(e.message), { status: 409 })
    return authFailureResponse(e, 'admin/bookings/pilgrims/PUT')
  }
}
