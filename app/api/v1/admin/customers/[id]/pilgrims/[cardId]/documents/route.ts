import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireCustomerManage } from '@/lib/customers/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { documentService, listCardDocuments, uploadableTypes } from '@/lib/documents/service'
import { createdResponse, docFailure, readUpload } from '@/lib/documents/http'
import { cardIdSchema, notFound } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; cardId: string }> }

// Dokumen kartu jamaah pelanggan `id`, dikelola staf (D4: admin boleh mengunggah atas nama pelanggan; `uploadedById` = staf).

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
    const documents = await listCardDocuments({ userId: session.userId, role: session.role }, k.ownerId, k.cardId)
    if (!documents) return notFound()
    return NextResponse.json(ok({ documents, types: await uploadableTypes() }))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/documents/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const k = await ids(params)
    if (!k) return notFound()
    const upload = await readUpload(req)
    if (upload instanceof NextResponse) return upload
    const r = await documentService.upload({ userId: session.userId, role: session.role }, k.ownerId, k.cardId, upload.fields, upload.file)
    return r.ok ? createdResponse(r.document) : docFailure(r)
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/documents/POST')
  }
}
