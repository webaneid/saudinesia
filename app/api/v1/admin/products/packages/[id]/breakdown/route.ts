import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { computePackageBreakdown } from '@/lib/pricing/computePackagePrice'

type Ctx = { params: Promise<{ id: string }> }

// Tabel breakdown HPP/Harga Jual per komponen + total per komponen "included" — untuk preview
// admin (docs/arsitektur-paket-umroh.md §5).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const breakdown = await computePackageBreakdown(id)
    return NextResponse.json(ok(breakdown))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/packages/[id]/breakdown/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
