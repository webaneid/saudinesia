import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { badRequest, cardIdSchema, parseBody } from '@/lib/pilgrims/http'
import { identityCardActionSchema } from '@/lib/validators/identities'
import { actOnCard } from '@/lib/pilgrims/warehouse'
import { identityNotFound, warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

type Ctx = { params: Promise<{ id: string; cardId: string }> }

// Kartu dalam identitas: `confirm` (orang yang sama — cocok manual), `detach` (NIK tidak sesuai — dilepas + pesan generik), `pin` (jadikan kanonik).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const p = await params
    const id = cardIdSchema.safeParse(p.id)
    const card = cardIdSchema.safeParse(p.cardId)
    if (!id.success || !card.success) return identityNotFound()
    const parsed = identityCardActionSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await actOnCard({ userId: session.userId, role: session.role }, id.data, card.data, parsed.data.action)
    return r.ok ? NextResponse.json(ok({ identity: r.identity })) : warehouseFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/[id]/cards/POST')
  }
}
