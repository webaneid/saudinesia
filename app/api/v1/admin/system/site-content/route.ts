import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { listPagesForAdmin } from '@/lib/public-content/service'

// Konten Situs (docs/arsitektur-frontend-publik.md §6.5 C6) — hanya superadmin (area Sistem). Daftar halaman tetap (registry kode).
export async function GET() {
  try { await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/system/site-content/GET') }
  try { return NextResponse.json(ok(await listPagesForAdmin())) } catch (e) {
    console.error('[admin/system/site-content/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
