import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { requirePricingView } from '@/lib/pricing/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { prisma } from '@/lib/db'
import { bookingPriceSummary } from '@/lib/pricing/engine/snapshot'
import { evaluatePricing } from '@/lib/pricing/warnings'

type Ctx = { params: Promise<{ id: string }> }

// Tiga total pesanan (HPP · rekomendasi · jual) + peringatan — INTERNAL admin (modal/rekomendasi tak pernah ke jamaah, I5). Peran: policy harga.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requirePricingView()
    const { id } = await params
    const booking = await prisma.booking.findUnique({ where: { id }, select: { id: true } })
    if (!booking) return NextResponse.json(err('Pesanan tidak ditemukan'), { status: 404 })
    const summary = await bookingPriceSummary(prisma, id)
    return NextResponse.json(ok({ summary, evaluation: evaluatePricing(summary) }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/pricing/GET')
  }
}
