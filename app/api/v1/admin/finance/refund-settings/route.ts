import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { refundSettingsSchema } from '@/lib/validators/refunds'
import { getRefundSettings, saveRefundSettings } from '@/lib/refunds/settings'
import { logError } from '@/lib/log'

// Kebijakan Refund (docs/rencana-force-majeure.md FM1) — hanya superadmin. Satu baris 'global', jejak settings_audit.
export async function GET() {
  try { await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/finance/refund-settings/GET') }
  try { return NextResponse.json(ok(await getRefundSettings())) } catch (e) {
    logError('admin/finance/refund-settings/GET', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request) {
  let session
  try { session = await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/finance/refund-settings/PUT') }
  const parsed = refundSettingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
  try {
    const r = await saveRefundSettings(parsed.data, session.userId)
    if (r.kind === 'stale') return NextResponse.json(err('Kebijakan sudah diubah orang lain — muat ulang halaman'), { status: 409 })
    return NextResponse.json(ok(r.settings))
  } catch (e) {
    logError('admin/finance/refund-settings/PUT', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
