import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { assignMuthowifToBooking } from '@/lib/muthowif/assign'
import { z } from 'zod'

const schema = z.object({ muthowifId: z.string().min(1) })

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
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    const bm = await prisma.bookingMuthowif.findFirst({
      where: { bookingId, muthowifId: null },
    })
    if (!bm) return NextResponse.json(err('Tidak ada layanan muthowif yang menunggu assignment untuk booking ini'), { status: 404 })

    await prisma.$transaction((tx) => assignMuthowifToBooking(tx, bm.id, parsed.data.muthowifId))

    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    if (e instanceof Error) {
      return NextResponse.json(err(e.message), { status: 409 })
    }
    console.error('[admin/bookings/[id]/muthowif/assign/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
