import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { ok, err } from '@/lib/validators'
import { bookingDraftSchema } from '@/lib/validators/booking'
import { requireBookingManage } from '@/lib/booking/policy'
import { deleteDraft, readDraft, saveDraft } from '@/lib/booking/drafts'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }
const putSchema = z.object({ draft: bookingDraftSchema, expectedUpdatedAt: z.string().datetime().optional() }).strict()

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const b = await prisma.booking.findUnique({
      where: { id },
      select: { id: true, bookingCode: true, status: true, draft: true, updatedAt: true, createdAt: true, user: { select: { id: true, fullName: true, email: true, allowVisaWithoutBundle: true } } },
    })
    if (!b || b.status !== 'draft') return NextResponse.json(err('Draf tidak ditemukan'), { status: 404 })
    const { defaultDueDays } = await getInvoiceSettings()
    return NextResponse.json(ok({ ...b, draft: readDraft(b.draft), defaultDueDays }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await saveDraft(id, parsed.data.draft, parsed.data.expectedUpdatedAt)
    if (!r.ok) return NextResponse.json(err(r.message), { status: r.status })
    return NextResponse.json(ok({ updatedAt: r.updatedAt }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const r = await deleteDraft(id)
    if (!r.ok) return NextResponse.json(err(r.message), { status: r.status })
    return NextResponse.json(ok({ deleted: true }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/DELETE')
  }
}
