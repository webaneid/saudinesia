import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { parseListParams } from '@/lib/table/pagination'
import { listUnmatchedCards } from '@/lib/pilgrims/warehouse'
import { identityNotFound } from '@/lib/pilgrims/warehouseHttp'

// Kartu jamaah tanpa kunci identitas (bayi tanpa NIK, §4.3) + saran identitas bernama dan bertanggal lahir sama.
export async function GET(req: Request) {
  try {
    const session = await requireAdmin()
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
    const r = await listUnmatchedCards({ userId: session.userId, role: session.role }, { ...parseListParams(url.searchParams), ...(q ? { q } : {}) })
    if (!r) return identityNotFound()
    return NextResponse.json(ok(r.items, { pagination: r.meta }))
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/unmatched/GET')
  }
}
