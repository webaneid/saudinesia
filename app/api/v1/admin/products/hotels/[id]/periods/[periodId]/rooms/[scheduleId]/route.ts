import { NextResponse } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { ok } from '@/lib/validators'
import { removeRoom } from '@/lib/hotels/periods'
import { periodFailure } from '@/lib/hotels/http'

// Hapus satu tipe kamar dari periode — hapus-aman (dirujuk → nonaktif). docs/arsitektur-hotel.md §12.2.
type Ctx = { params: Promise<{ id: string; periodId: string; scheduleId: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, periodId, scheduleId } = await params
    return NextResponse.json(ok(await removeRoom(id, periodId, scheduleId)))
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/rooms/[scheduleId]')
  }
}
