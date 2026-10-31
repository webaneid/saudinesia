import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { invoiceLinkToken, invoiceLinkUrl } from '@/lib/invoice/link'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Tautan invoice publik untuk disalin admin (docs/arsitektur-booking-engine-v2.md §10.4 6c). Token dihitung, tidak disimpan; tak pernah dicatat di log.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const inv = await prisma.invoice.findUnique({ where: { bookingId: id }, select: { id: true, linkVersion: true, booking: { select: { status: true } } } })
    if (!inv || inv.booking.status === 'draft') return NextResponse.json(err('Invoice tidak ditemukan'), { status: 404 })
    const token = invoiceLinkToken(inv)
    const url = invoiceLinkUrl(token)
    return NextResponse.json(ok({ url: url || `/id/invoice/${token}`, absolute: url !== '', linkVersion: inv.linkVersion }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/[id]/invoice-link/GET')
  }
}
