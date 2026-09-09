import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { computeTourPackageBreakdown } from '@/lib/pricing/computeTourPackagePrice'

type Ctx = { params: Promise<{ id: string }> }

// Tabel breakdown HPP/Harga Jual per komponen + total per opsi kendaraan — untuk preview admin
// (docs/arsitektur-ziarah.md §8.3/§8.6).
export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const breakdown = await computeTourPackageBreakdown(id)
    return NextResponse.json(ok(breakdown))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    console.error('[admin/products/tour-packages/[id]/breakdown/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
