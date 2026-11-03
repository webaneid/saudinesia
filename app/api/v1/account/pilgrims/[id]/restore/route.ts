import { onboardingRefusal } from '@/lib/auth/contact'
import { restoreSavedPilgrim } from '@/lib/pilgrims/service'
import { requirePilgrimActor } from '@/lib/pilgrims/session'
import { cardIdSchema, ipLimited, notFound, routeFailure, writeResponse } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string }> }

// Pulihkan kartu "Jamaah Saya" dari arsip.
export async function POST(req: Request, { params }: Ctx) {
  try {
    const actor = await requirePilgrimActor()
    const refusal = await onboardingRefusal(actor.userId, actor.role)
    if (refusal) return refusal
    const id = cardIdSchema.safeParse((await params).id)
    if (!id.success) return notFound()
    const limited = await ipLimited(req)
    if (limited) return limited
    return writeResponse(await restoreSavedPilgrim(actor, actor.userId, id.data))
  } catch (e) {
    return routeFailure(e, 'account/pilgrims/[id]/restore/POST')
  }
}
