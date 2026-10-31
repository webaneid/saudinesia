import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/validators'
import { requireBookingManage } from '@/lib/booking/policy'
import { publishDraft } from '@/lib/booking/drafts'
import { authFailureResponse } from '@/lib/admin/errors'
import { sendInvoiceNotification } from '@/lib/invoice/notifyInvoice'

type Ctx = { params: Promise<{ id: string }> }
const schema = z.object({ dueDays: z.number().int().min(0).max(365).optional(), expectedUpdatedAt: z.string().datetime().optional() }).strict()

// Terbitkan draf (lib/booking/drafts.ts): kuota ditahan, harga dibekukan, status aktif, invoice terbit; pelanggan diberi tahu dengan tautan invoice publik (Fase 6c).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireBookingManage()
    const { id } = await params
    const parsed = schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await publishDraft(id, { ...parsed.data, byUserId: session.userId })
    if (!r.ok) return NextResponse.json({ success: false, error: r.message, ...(r.violations && { meta: { violations: r.violations } }) }, { status: r.status })
    // Notifikasi invoice terbit berisi tautan publik (P2, menutup K5-1) — setelah commit, best-effort (tak menggagalkan terbit).
    void sendInvoiceNotification(r.id, { dedupe: true })
    return NextResponse.json(ok({ id: r.id, bookingCode: r.bookingCode, invoiceNumber: r.invoiceNumber }))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/publish')
  }
}
