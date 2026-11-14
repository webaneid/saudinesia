import { NextResponse } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse, isAuthError } from '@/lib/admin/errors'
import { departureUpdateSchema } from '@/lib/validators/package'
import { deleteOrDeactivateDeparture, updateDeparture } from '@/lib/packages/departures'
import { departureFailureResponse } from '@/lib/packages/http'

// Ubah / hapus-aman satu keberangkatan, dicakup ke paketnya (id keberangkatan paket lain = 404).
type Ctx = { params: Promise<{ id: string; departureId: string }> }

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, departureId } = await params
    const parsed = departureUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await updateDeparture(id, departureId, parsed.data)))
  } catch (e) {
    if (isAuthError(e)) return authFailureResponse(e, 'admin/packages/departures/PUT')
    const known = departureFailureResponse(e)
    if (known) return known
    console.error('[admin/packages/departures/PUT]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id, departureId } = await params
    const r = await deleteOrDeactivateDeparture(id, departureId)
    // `data.message` = pesan hasil yang ditampilkan ApiAction (pola hapus-aman vendor/produk).
    return NextResponse.json(ok(r.deleted ? r : { ...r, message: `Keberangkatan ini sudah dipesan (${r.bookingCount} booking), jadi dinonaktifkan, bukan dihapus.` }))
  } catch (e) {
    if (isAuthError(e)) return authFailureResponse(e, 'admin/packages/departures/DELETE')
    const known = departureFailureResponse(e)
    if (known) return known
    console.error('[admin/packages/departures/DELETE]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
