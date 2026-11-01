import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ok, err } from '@/lib/validators'
import { bookingDraftSchema } from '@/lib/validators/booking'
import { requireBookingManage } from '@/lib/booking/policy'
import { previewDraft } from '@/lib/booking/drafts'
import { authFailureResponse } from '@/lib/admin/errors'

type Ctx = { params: Promise<{ id: string }> }

// Pratinjau = simulasi terbit yang di-rollback (lib/booking/drafts.ts). POST karena menjalankan mesin pesan (kunci + tulis yang dibatalkan), bukan bacaan murni.
// Badan opsional `{ draft }` = isi yang BELUM disimpan (editor baris memperbarui total otomatis); divalidasi skema draf yang sama (`.strict()`), tak disimpan.
const schema = z.object({ draft: bookingDraftSchema.optional() }).strict()

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireBookingManage()
    const { id } = await params
    const parsed = schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const r = await previewDraft(id, parsed.data.draft)
    if (!r.ok) return NextResponse.json({ success: false, error: r.message, ...((r.violations || r.itemIndex !== undefined) && { meta: { violations: r.violations ?? [], ...(r.itemIndex !== undefined && { itemIndex: r.itemIndex }) } }) }, { status: r.status })
    return NextResponse.json(ok(r.preview))
  } catch (e) {
    return authFailureResponse(e, 'admin/bookings/drafts/[id]/preview')
  }
}
