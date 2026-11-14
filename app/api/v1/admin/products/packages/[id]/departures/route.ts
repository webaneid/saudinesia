import { NextResponse } from 'next/server'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse, isAuthError } from '@/lib/admin/errors'
import { departureCreateSchema } from '@/lib/validators/package'
import { createDeparture, listDepartures } from '@/lib/packages/departures'
import { departureFailureResponse, loadDepartureWarnings } from '@/lib/packages/http'

// Keberangkatan Paket Umroh (K1, docs/arsitektur-paket-umroh.md §8) — daftar + peringatan editor, dan tambah. Penulis: lib/packages/departures.ts.
type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const departures = await listDepartures(id)
    return NextResponse.json(ok(departures, { warnings: await loadDepartureWarnings(id, departures) }))
  } catch (e) {
    if (isAuthError(e)) return authFailureResponse(e, 'admin/packages/departures/GET')
    const known = departureFailureResponse(e)
    if (known) return known
    console.error('[admin/packages/departures/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = departureCreateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await createDeparture(id, parsed.data)), { status: 201 })
  } catch (e) {
    if (isAuthError(e)) return authFailureResponse(e, 'admin/packages/departures/POST')
    const known = departureFailureResponse(e)
    if (known) return known
    console.error('[admin/packages/departures/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
