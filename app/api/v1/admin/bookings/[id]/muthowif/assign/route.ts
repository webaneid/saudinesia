import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { assignMuthowifToBooking } from '@/lib/muthowif/assign'
import { isRecordNotFound } from '@/lib/admin/errors'
import { z } from 'zod'

// `bookingMuthowifId` wajib (§10.8, 11d-2b): booking berrombongan bisa memuat beberapa layanan muthowif — penugasan harus menyebut itemnya.
const schema = z.object({ bookingMuthowifId: z.string().min(1).max(64), muthowifId: z.string().min(1).max(64) }).strict()

type Ctx = { params: Promise<{ id: string }> }

// Roster aktif untuk dropdown assign — akses level admin (bukan manager) karena ini aksi
// operasional harian, sama seperti konfirmasi pembayaran.
export async function GET() {
  try {
    await requireAdmin()
    const roster = await prisma.muthowif.findMany({
      where: { isActive: true },
      select: { id: true, name: true, dailyCapacity: true },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(ok(roster))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/bookings/[id]/muthowif/assign/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

// Assign muthowif spesifik ke booking — keputusan kurasi admin, dilakukan SETELAH booking
// dibuat, bukan pilihan jamaah saat booking (docs/arsitektur-muthowif.md §9).
export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireAdmin()
    const { id: bookingId } = await params
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const bm = await prisma.bookingMuthowif.findFirst({
      where: { id: parsed.data.bookingMuthowifId, bookingId, muthowifId: null },
      select: { id: true },
    })
    if (!bm) return NextResponse.json(err('Layanan muthowif ini tidak ada di booking ini atau sudah di-assign'), { status: 404 })

    await prisma.$transaction((tx) => assignMuthowifToBooking(tx, bm.id, parsed.data.muthowifId))

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (isRecordNotFound(e)) return NextResponse.json(err('Muthowif tidak ditemukan'), { status: 404 })
    // Galat domain (sudah di-assign, nonaktif, kapasitas) = Error polos → 409 dengan pesannya; galat Prisma (ber-`code`) tak pernah dibocorkan.
    if (e instanceof Error && !('code' in e)) {
      return NextResponse.json(err(e.message), { status: 409 })
    }
    console.error('[admin/bookings/[id]/muthowif/assign/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
