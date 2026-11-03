import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { onboardingRefusal } from '@/lib/auth/contact'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { createSavedPilgrim, listSavedPilgrims } from '@/lib/pilgrims/service'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { badRequest, ipLimited, listOptionsOf, parseBody, routeFailure, writeResponse } from '@/lib/pilgrims/http'

// "Jamaah Saya" (docs/arsitektur-jamaah.md §4, Fase 3): daftar & simpan kartu jamaah milik akun yang masuk. Kepemilikan = sesi, bukan masukan.
// Respons simpan identik apakah NIK baru / sudah ada di akun lain / konflik (tanpa orakel) — dijaga scripts/test-pilgrims.ts.

export async function GET(req: Request) {
  try {
    const actor = await requirePilgrimActor()
    const list = await listSavedPilgrims(actor, actor.userId, listOptionsOf(new URL(req.url)))
    return NextResponse.json(ok(list!.items, { pagination: list!.meta }))
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/GET')
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const limited = await ipLimited(req)
    if (limited) return limited
    const parsed = savedPilgrimInputSchema.safeParse(await parseBody(req))
    if (!parsed.success) return badRequest(parsed.error)
    return writeResponse(await createSavedPilgrim(actor, actor.userId, parsed.data), true)
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/POST')
  }
}
