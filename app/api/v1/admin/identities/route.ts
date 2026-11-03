import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { parseListParams } from '@/lib/table/pagination'
import { identityFilterSchema } from '@/lib/validators/identities'
import { listIdentities } from '@/lib/pilgrims/warehouse'
import { warehouseFailure } from '@/lib/pilgrims/warehouseHttp'

// Gudang identitas jamaah — daftar (docs/arsitektur-jamaah.md §4.4, Fase 8; K4: semua peran staf). `q` 16 digit = NIK tepat lewat indeks HMAC.
export async function GET(req: Request) {
  try {
    const session = await requireAdmin()
    const url = new URL(req.url)
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100)
    const r = await listIdentities({ userId: session.userId, role: session.role }, {
      ...parseListParams(url.searchParams), ...(q ? { q } : {}), filter: identityFilterSchema.parse(url.searchParams.get('status') ?? 'all'),
    })
    if ('ok' in r) return warehouseFailure(r)
    return NextResponse.json(ok(r.items, { pagination: r.meta }))
  } catch (e) {
    return authFailureResponse(e, 'admin/identities/GET')
  }
}
