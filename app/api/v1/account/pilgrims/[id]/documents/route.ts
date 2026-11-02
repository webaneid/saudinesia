import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { documentService, listCardDocuments, uploadableTypes } from '@/lib/documents/service'
import { createdResponse, docFailure, docIpLimited, readUpload } from '@/lib/documents/http'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, notFound, routeFailure } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string }> }

// Dokumen satu kartu "Jamaah Saya" (docs/arsitektur-jamaah.md §7). Kartu akun lain → 404 yang sama dengan kartu yang tak ada.

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const documents = await listCardDocuments(actor, actor.userId, id.data)
    if (!documents) return notFound()
    return NextResponse.json(ok({ documents, types: await uploadableTypes() }))
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/documents/GET')
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const limited = await docIpLimited(req)
    if (limited) return limited
    const upload = await readUpload(req)
    if (upload instanceof NextResponse) return upload
    const r = await documentService.upload(actor, actor.userId, id.data, upload.fields, upload.file)
    return r.ok ? createdResponse(r.document) : docFailure(r)
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/documents/POST')
  }
}
