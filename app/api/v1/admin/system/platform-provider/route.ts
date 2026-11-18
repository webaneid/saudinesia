import { NextResponse } from 'next/server'
import { ok, err } from '@/lib/validators'
import { revenueShareSettingSchema } from '@/lib/validators/revenueShare'
import { requirePlatformProvider, requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { currentRevenueShare, platformProviderConfigured, revenueShareHistory, RevenueShareError, saveRevenueShare } from '@/lib/revenue-share/settings'

// Sistem → Platform Provider (docs/arsitektur-bagi-hasil.md, Fase 13a). Baca: superadmin (klien melihat kesepakatan). Ubah: HANYA akun Platform Provider.

export async function GET() {
  try {
    const session = await requireSuperAdmin()
    const [current, history, configured] = await Promise.all([currentRevenueShare(), revenueShareHistory(), platformProviderConfigured()])
    return NextResponse.json(ok({ current, history, configured, canEdit: session.isPlatformProvider }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/GET')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePlatformProvider()
    const parsed = revenueShareSettingSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const current = await saveRevenueShare(parsed.data, session.userId)
    return NextResponse.json(ok({ current }), { status: 201 })
  } catch (e) {
    if (e instanceof RevenueShareError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/system/platform-provider/POST')
  }
}
