import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { deleteSavedPilgrim, getSavedPilgrim, updateSavedPilgrim } from '@/lib/pilgrims/service'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { badRequest, cardIdSchema, deleteResponse, ipLimited, notFound, parseBody, routeFailure, writeResponse } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string }> }

// Satu kartu "Jamaah Saya". Kartu akun lain → 404 yang sama dengan kartu yang tak ada (kepemilikan dicek di layanan, cakupan = ownerId sesi).

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const card = await getSavedPilgrim(actor, actor.userId, id.data)
    return card ? NextResponse.json(ok(card)) : notFound()
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    const parsed = savedPilgrimInputSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    return writeResponse(await updateSavedPilgrim(actor, actor.userId, id.data, parsed.data))
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/[id]/PUT')
  }
}

// Menghapus data pribadi sendiri tidak digerbang onboarding (hak subjek data), tapi tetap dibatasi laju.
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    return deleteResponse(await deleteSavedPilgrim(actor, actor.userId, id.data))
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/[id]/DELETE')
  }
}
