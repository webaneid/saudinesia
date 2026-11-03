import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { badRequest, cardIdSchema, parseBody } from '@/lib/pilgrims/http'
import { identityRevealSchema } from '@/lib/validators/identities'
import { revealIdentity } from '@/lib/pilgrims/warehouse'
import { identityNotFound, warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

type Ctx = { params: Promise<{ id: string }> }

// Buka NIK identitas / nomor paspor kartu, utuh (K4) — berjejak (`nik_revealed`/`passport_revealed`), tak pernah di-cache.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return identityNotFound()
    const parsed = identityRevealSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    const r = await revealIdentity({ userId: session.userId, role: session.role }, id.data, parsed.data)
    const res = r.ok ? NextResponse.json(ok({ value: r.value })) : warehouseFailure(r)
    res.headers.set('Cache-Control', 'no-store')
    return res
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/[id]/reveal/POST')
  }
}
