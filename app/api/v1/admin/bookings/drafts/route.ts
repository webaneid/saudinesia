import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { createDraft } from '@/lib/booking/drafts'
import { authFailureResponse } from '@/lib/admin/errors'

const schema = z.object({ customerId: z.string().uuid('Pilih pelanggan') }).strict()

// Buat draf booking untuk pelanggan (docs/arsitektur-booking-engine-v2.md §10.3). Draf kosong; isinya disimpan lewat PUT /drafts/[id].
export async function POST(req: Request) {
  try {
    await requireBookingManage()
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await createDraft(parsed.data.customerId)
    if (!r.ok) return NextResponse.json(err(r.message), { status: r.status })
    return NextResponse.json(ok({ id: r.id, bookingCode: r.bookingCode }), { status: 201 })
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/POST')
  }
}
