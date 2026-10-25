import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/auth/session'
import { resetAccountLimits } from '@/lib/auth/rateLimit'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'

// SEC-14: buka kunci pembatasan login + email auth satu akun (korban lockout-DoS yang meminta bantuan). Hanya superadmin.
// Batas per-IP tidak disentuh. Tanpa body — satu-satunya masukan adalah id di path.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const user = await prisma.user.findUnique({ where: { id }, select: { email: true } })
    if (!user) return NextResponse.json(err('Pengguna tidak ditemukan'), { status: 404 })

    const cleared = await resetAccountLimits(user.email)
    // Jejak audit tanpa PII: hanya id pelaku, id target, dan jumlah kunci.
    console.info(`[admin/reset-limits] actor=${session.userId} target=${id} cleared=${cleared}`)
    return NextResponse.json(ok({ cleared }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/users/[id]/reset-limits/POST')
  }
}
