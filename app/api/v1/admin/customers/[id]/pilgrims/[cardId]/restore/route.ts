import { requireCustomerManage } from '@/lib/customers/policy'
import { authFailureResponse } from '@/lib/admin/errors'
import { restoreSavedPilgrim } from '@/lib/pilgrims/service'
import { cardIdSchema, notFound, writeResponse } from '@/lib/pilgrims/http'

type Ctx = { params: Promise<{ id: string; cardId: string }> }

// Pulihkan kartu jamaah pelanggan dari arsip (staf).
export async function POST(_req: Request, { params }: Ctx) {
  try {
    const session = await requireCustomerManage()
    const p = await params
    const owner = cardIdSchema.safeParse(p.id)
    const card = cardIdSchema.safeParse(p.cardId)
    if (!owner.success || !card.success) return notFound()
    return writeResponse(await restoreSavedPilgrim({ userId: session.userId, role: session.role }, owner.data, card.data))
  } catch (e) {
    return authFailureResponse(e, 'admin/customers/pilgrims/[cardId]/restore/POST')
  }
}
