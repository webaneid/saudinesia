import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireCustomerManage } from '@/lib/customers/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { deleteSavedPilgrim, getSavedPilgrim, updateSavedPilgrim } from '@/lib/pilgrims/service'
import { badRequest, cardIdSchema, deleteResponse, notFound, parseBody, writeResponse } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; cardId: string }> }

// Satu kartu jamaah pelanggan `id`, dikelola staf. Kartu milik pelanggan lain → 404 (cakupan ownerId di layanan).

async function ids(params: Ctx['params']) {
  const p = await params
  const owner = cardIdSchema.safeParse(p.id)
  const card = cardIdSchema.safeParse(p.cardId)
  return owner.success && card.success ? { ownerId: owner.data, cardId: card.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return notFound()
    const card = await getSavedPilgrim({ userId: session.userId, role: session.role }, k.ownerId, k.cardId)
    return card ? NextResponse.json(ok(card)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/[cardId]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return notFound()
    const parsed = savedPilgrimInputSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    return writeResponse(await updateSavedPilgrim({ userId: session.userId, role: session.role }, k.ownerId, k.cardId, parsed.data))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/[cardId]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return notFound()
    return deleteResponse(await deleteSavedPilgrim({ userId: session.userId, role: session.role }, k.ownerId, k.cardId))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/[cardId]/DELETE')
  }
}
