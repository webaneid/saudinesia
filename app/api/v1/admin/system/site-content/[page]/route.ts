import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { pageContentInputSchema } from '@/lib/validators/publicContent'
import { isPublicPageKey } from '@/lib/public-content/pages'
import { getPageForAdmin, savePageContent } from '@/lib/public-content/service'

// Isi satu halaman publik (docs/arsitektur-frontend-publik.md §6.5 C3, C6) — hanya superadmin. Halaman di luar registry → 404.
type Ctx = { params: Promise<{ page: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  try { await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/system/site-content/[page]/GET') }
  const { page } = await ctx.params
  if (!isPublicPageKey(page)) return NextResponse.json(err('Halaman tidak ditemukan'), { status: 404 })
  try { return NextResponse.json(ok(await getPageForAdmin(page))) } catch (e) {
    console.error('[admin/system/site-content/[page]/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  let session
  try { session = await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/system/site-content/[page]/PUT') }
  const { page } = await ctx.params
  if (!isPublicPageKey(page)) return NextResponse.json(err('Halaman tidak ditemukan'), { status: 404 })
  const parsed = pageContentInputSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
  try {
    const result = await savePageContent(page, parsed.data, session.userId)
    if (!result.ok) return NextResponse.json(err(result.message), { status: result.status })
    return NextResponse.json(ok({ updatedAt: result.updatedAt }))
  } catch (e) {
    console.error('[admin/system/site-content/[page]/PUT]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
