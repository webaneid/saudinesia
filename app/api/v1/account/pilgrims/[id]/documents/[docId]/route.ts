import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { documentService } from '@/lib/documents/service'
import { docFailure, docIdSchema, docIpLimited, docNotFound } from '@/lib/documents/http'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, routeFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; docId: string }> }

async function ids(params: Ctx['params']) {
  const p = await params
  const card = cardIdSchema.safeParse(p.id)
  const doc = docIdSchema.safeParse(p.docId)
  return card.success && doc.success ? { cardId: card.data, docId: doc.data } : null
}

// Lihat: URL presigned 15 menit (bucket privat). Respons tak boleh di-cache — URL bertanda tangan.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const k = await ids(params)
    if (!k) return docNotFound()
    const r = await documentService.previewUrl(actor, actor.userId, k.cardId, k.docId)
    if (!r.ok) return docFailure(r)
    return NextResponse.json(ok({ url: r.url, mimeType: r.mimeType }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/documents/[docId]/GET')
  }
}

// Menghapus dokumen sendiri tidak digerbang onboarding (hak subjek data), tetap dibatasi laju.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const k = await ids(params)
    if (!k) return docNotFound()
    const limited = await docIpLimited(req)
    if (limited) return limited
    const r = await documentService.remove(actor, actor.userId, k.cardId, k.docId)
    return r.ok ? NextResponse.json(ok({ deleted: true })) : docFailure(r)
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/documents/[docId]/DELETE')
  }
}
