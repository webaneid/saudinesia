import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { badRequest, cardIdSchema, parseBody } from '@/lib/pilgrims/http'
import { identityMergeSchema } from '@/lib/validators/identities'
import { mergeIdentities } from '@/lib/pilgrims/warehouse'
import { identityNotFound, warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

type Ctx = { params: Promise<{ id: string }> }

// Gabung dua identitas orang yang sama ke identitas yang DIPILIH petugas (`keep`); kunci yang lain menjadi alias (§4.4).
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return identityNotFound()
    const parsed = identityMergeSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const [keepId, dropId] = parsed.data.keep === 'this' ? [id.data, parsed.data.otherId] : [parsed.data.otherId, id.data]
    const r = await mergeIdentities({ userId: session.userId, role: session.role }, keepId, dropId)
    return r.ok ? NextResponse.json(ok({ identityId: r.identityId })) : warehouseFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/[id]/merge/POST')
  }
}
