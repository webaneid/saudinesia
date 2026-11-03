import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { cardIdSchema } from '@/lib/pilgrims/http'
import { eraseIdentity, getIdentity } from '@/lib/pilgrims/warehouse'
import { identityNotFound, warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

type Ctx = { params: Promise<{ id: string }> }

// Satu identitas jamaah: detail (NIK tersamar) dan hapus atas permintaan subjek data — hanya bila tak pernah dipakai booking (§4.4).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return identityNotFound()
    const d = await getIdentity({ userId: session.userId, role: session.role }, id.data)
    return d ? NextResponse.json(ok(d)) : identityNotFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/[id]/GET')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireAdmin()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return identityNotFound()
    const r = await eraseIdentity({ userId: session.userId, role: session.role }, id.data)
    return r.ok ? NextResponse.json(ok({ deleted: true, cardsDetached: r.cardsDetached })) : warehouseFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/[id]/DELETE')
  }
}
