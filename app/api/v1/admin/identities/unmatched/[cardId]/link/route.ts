import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { badRequest, cardIdSchema, parseBody } from '@/lib/pilgrims/http'
import { identityLinkSchema } from '@/lib/validators/identities'
import { linkUnmatchedCard } from '@/lib/pilgrims/warehouse'
import { identityNotFound, warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

type Ctx = { params: Promise<{ cardId: string }> }

// Tautkan kartu tanpa kunci ke identitas pilihan petugas (§4.3).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const card = cardIdSchema.safeParse((await params).cardId)
    if (!card.success) return identityNotFound()
    const parsed = identityLinkSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await linkUnmatchedCard({ userId: session.userId, role: session.role }, card.data, parsed.data.identityId)
    return r.ok ? NextResponse.json(ok({ linked: true })) : warehouseFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/unmatched/link/POST')
  }
}
