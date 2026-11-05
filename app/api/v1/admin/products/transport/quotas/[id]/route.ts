import { NextResponse } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { deleteQuota, TransportQuotaError, updateQuotaSeats } from '@/lib/transport/quotas'
import { ok, err } from '@/lib/validators'
import { updateQuotaSchema } from '@/lib/validators/transportQuota'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = updateQuotaSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    await updateQuotaSeats(id, parsed.data.totalSeats)
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof TransportQuotaError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/products/transport/quotas/[id]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    await deleteQuota(id)
    return NextResponse.json(ok(null))
  } catch (e) {
    if (e instanceof TransportQuotaError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/products/transport/quotas/[id]/DELETE')
  }
}
