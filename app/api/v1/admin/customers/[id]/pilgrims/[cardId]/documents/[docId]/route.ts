import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireCustomerManage } from '@/lib/customers/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { documentService } from '@/lib/documents/service'
import { docFailure, docIdSchema, docNotFound } from '@/lib/documents/http'
import { cardIdSchema } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; cardId: string; docId: string }> }

async function ids(params: Ctx['params']) {
  const p = await params
  const owner = cardIdSchema.safeParse(p.id)
  const card = cardIdSchema.safeParse(p.cardId)
  const doc = docIdSchema.safeParse(p.docId)
  return owner.success && card.success && doc.success ? { ownerId: owner.data, cardId: card.data, docId: doc.data } : null
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return docNotFound()
    const r = await documentService.previewUrl({ userId: session.userId, role: session.role }, k.ownerId, k.cardId, k.docId)
    if (!r.ok) return docFailure(r)
    return NextResponse.json(ok({ url: r.url, mimeType: r.mimeType }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/documents/[docId]/GET')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return docNotFound()
    const r = await documentService.remove({ userId: session.userId, role: session.role }, k.ownerId, k.cardId, k.docId)
    return r.ok ? NextResponse.json(ok({ deleted: true })) : docFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/documents/[docId]/DELETE')
  }
}
