import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { quotaAdapters } from '@/lib/quota/adapters'
import { notify } from '@/lib/notifications/notify'
import { z } from 'zod'

const schema = z.object({ action: z.enum(['confirm', 'reject']), notes: z.string().optional() })

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin()
    const { id }  = await params
    const parsed  = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err('Input tidak valid'), { status: 400 })

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { booking: { include: { hotels: true, transports: true, muthowif: true, tourPackages: true, haji: true, user: true } } },
    })
    if (!payment) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })

    const { action } = parsed.data
    const { booking } = payment

    if (action === 'confirm') {
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id }, data: { status: 'confirmed', confirmedById: session.userId, confirmedAt: new Date() } })
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'confirmed' } })
        // Loop generik via adapter registry (docs/arsitektur-booking.md §6 Step 1) — tidak mungkin
        // lagi ada tipe yang "terlupa" seperti insiden Muthowif kemarin.
        for (const h of booking.hotels) await quotaAdapters.hotel.confirm(tx, h)
        for (const t of booking.transports) await quotaAdapters.transport.confirm(tx, t)
        for (const tp of booking.tourPackages) await quotaAdapters.tourPackage.confirm(tx, tp)
        for (const bm of booking.muthowif) await quotaAdapters.muthowif.confirm(tx, bm)
        for (const bh of booking.haji) await quotaAdapters.haji.confirm(tx, bh)
      })
      // Best-effort, tidak memblokir respons; notify() tidak pernah melempar dan mencatat status jujur per kanal.
      void notify({ userId: booking.userId, bookingId: booking.id, event: { type: 'payment_confirmed', code: booking.bookingCode } })
    } else {
      await prisma.payment.update({ where: { id }, data: { status: 'rejected', notes: parsed.data.notes ?? null } })
      await prisma.booking.update({ where: { id: booking.id }, data: { status: 'awaiting_payment' } })
      void notify({ userId: booking.userId, bookingId: booking.id, event: { type: 'payment_rejected', code: booking.bookingCode } })
    }

    return NextResponse.json(ok({ action }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/payments/confirm]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
