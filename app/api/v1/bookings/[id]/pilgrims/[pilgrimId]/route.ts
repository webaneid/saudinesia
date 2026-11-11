import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, boundedKeys } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { clearSlot, pilgrimBookingState } from '@/lib/pilgrims/bookingLink'
import { saveExtraFields } from '@/lib/pilgrims/extraFields'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { badRequest, cardIdSchema, closedBooking, ipLimited, notFound, parseBody, routeFailure, serviceFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; pilgrimId: string }> }

const extraSchema = z.object({
  fieldValues: boundedKeys(50, 'Terlalu banyak field', z.record(z.string().max(64), z.unknown())),
}).strict()

// ISI kolom tambahan (bukan dari kartu Jamaah Saya) jamaah di booking AKTIF MILIK sesi — audit front-end 2026-11-11. Kolom berperan kartu
// ditolak; aturan, kunci, dan kunci-pemeriksaan di lib/pilgrims/extraFields.ts.
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const p = await params
    const b = cardIdSchema.safeParse(p.id)
    const bp = cardIdSchema.safeParse(p.pilgrimId)
    if (!b.success || !bp.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    const parsed = extraSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await saveExtraFields(actor.userId, b.data, bp.data, parsed.data.fieldValues)
    return r.ok ? NextResponse.json(ok({ completeness: r.completeness })) : serviceFailure(r)
  } catch (e) {
    return routeFailure(e, 'bookings/pilgrims/PUT')
  }
}

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
