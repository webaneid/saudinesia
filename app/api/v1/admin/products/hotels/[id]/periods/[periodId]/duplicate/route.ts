import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { periodDuplicateSchema } from '@/lib/validators/hotelPeriod'
import { duplicatePeriod } from '@/lib/hotels/periods'
import { periodFailure } from '@/lib/hotels/http'

// Duplikat periode (docs/arsitektur-hotel.md §12.2): menyalin tipe kamar, kuota, biaya modal/vendor, dan harga jual manual. Menyalin HPP → superadmin (sama dengan simpan harga).
type Ctx = { params: Promise<{ id: string; periodId: string }> }

export async function POST(req: Request, { params }: Ctx) {
  try {
    const session = await requireSuperAdmin()
    const { id, periodId } = await params
    const parsed = periodDuplicateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await duplicatePeriod(id, periodId, parsed.data, session.userId)), { status: 201 })
  } catch (e) {
    return periodFailure(e, 'admin/products/hotels/[id]/periods/[periodId]/duplicate')
  }
}
