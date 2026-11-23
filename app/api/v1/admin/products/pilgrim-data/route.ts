import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { authFailureResponse } from '@/lib/admin/errors'
import { PILGRIM_DATA_OWNER_TYPES } from '@/lib/pilgrim-data/owners'
import { pilgrimDataState, setPilgrimDataEnabled } from '@/lib/pilgrim-data/products'

// Saklar "minta data jamaah" per produk (docs/arsitektur-data-jamaah.md §3.2, D3) — manager+, sama dengan editor produk.
// Satu route untuk semua jenis produk: jenis dinilai registry, id = uuid, produk harus ada (dicek di dalam kunci oleh penulisnya).

const ref = { productType: z.enum(PILGRIM_DATA_OWNER_TYPES), productId: z.string().uuid() }
const querySchema = z.object(ref).strict()
const putSchema = z.object({ ...ref, enabled: z.boolean() }).strict()
const notFound = () => NextResponse.json(err('Produk tidak ditemukan'), { status: 404 })

export async function GET(req: Request) {
  try {
    await requireManager()
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const state = await pilgrimDataState(parsed.data)
    return state ? NextResponse.json(ok(state)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-data/GET')
  }
}

export async function PUT(req: Request) {
  try {
    await requireManager()
    const parsed = putSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return NextResponse.json({ ...err(issue?.message ?? 'Data tidak valid'), ...(issue?.path.length ? { meta: { field: issue.path.join('.') } } : {}) }, { status: 400 })
    }
    const { enabled, ...product } = parsed.data
    const state = await setPilgrimDataEnabled(product, enabled)
    return state ? NextResponse.json(ok(state)) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/products/pilgrim-data/PUT')
  }
}
