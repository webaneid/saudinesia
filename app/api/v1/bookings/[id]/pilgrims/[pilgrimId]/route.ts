import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { clearSlot, pilgrimBookingState } from '@/lib/pilgrims/bookingLink'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, closedBooking, ipLimited, notFound, routeFailure, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

// KOSONGKAN slot jamaah di booking MILIK sesi (aksi Hapus di tabel jamaah, pemilik 2026-11-10): kartu dilepas, isian + segel NIK/paspor
// dihapus; slot tetap ada (jumlah jamaah = tagihan). Booking/jamaah akun lain → 404 sama dengan "tidak ada" (lib/pilgrims/bookingLink.ts).
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const p = await params
    const b = cardIdSchema.safeParse(p.id)
    const bp = cardIdSchema.safeParse(p.pilgrimId)
    if (!b.success || !bp.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    const state = await pilgrimBookingState(b.data, actor.userId)
    if (state === 'missing') return notFound()
    if (state === 'closed') return closedBooking()
    const r = await clearSlot(actor, b.data, bp.data)
    return r.ok ? NextResponse.json(ok({ cleared: true })) : serviceFailure(r)
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/DELETE')
  }
}
