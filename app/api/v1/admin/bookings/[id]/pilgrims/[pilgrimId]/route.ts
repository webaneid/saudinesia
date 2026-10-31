import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { getManifestFieldRequirements } from '@/lib/manifest/getRequirements'
import { CORE_MANIFEST_PRODUCT_ID, CORE_MANIFEST_PRODUCT_TYPE } from '@/lib/manifest/constants'
import { completeness, validateFieldValues } from '@/lib/manifest/values'
import { dbDateOf } from '@/lib/time'
import { authFailureResponse } from '@/lib/admin/errors'
import { isDeletedAccount } from '@/lib/customers/query'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }
const schema = z.object({
  fieldValues: z.record(z.string().max(64), z.unknown()).refine(v => Object.keys(v).length <= 50, 'Terlalu banyak field'),
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
      select: { visaApplication: { select: { id: true, visaProductId: true } }, booking: { select: { user: { select: { email: true } } } } },
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

    const values = await prisma.$transaction(async (tx) => {
      // Baca-gabung-tulis di dalam kunci baris: dua admin yang menyimpan field berbeda bersamaan tak saling menimpa. $queryRaw: Prisma ORM tak punya FOR UPDATE.
      const locked = await tx.$queryRaw<Array<{ fieldValues: unknown }>>(Prisma.sql`SELECT "fieldValues" FROM "booking_pilgrims" WHERE "id" = ${pilgrimId} FOR UPDATE`)
      const merged = { ...((locked[0]?.fieldValues ?? {}) as Record<string, unknown>), ...checked.values }
      await tx.bookingPilgrim.update({ where: { id: pilgrimId }, data: { fieldValues: merged as Prisma.InputJsonValue } })
      if (parsed.data.plannedTravelDate !== undefined && pilgrim.visaApplication) {
        await tx.visaApplication.update({ where: { id: pilgrim.visaApplication.id }, data: { plannedTravelDate: parsed.data.plannedTravelDate ? dbDateOf(parsed.data.plannedTravelDate) : null } })
      }
      return merged
    })
    return NextResponse.json(ok({ completeness: completeness(fields, values) }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pilgrims/PUT')
  }
}
