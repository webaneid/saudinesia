import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { integrationStatus } from '@/lib/notifications/integrations'
import { logError } from '@/lib/log'

// Status konfigurasi saja (boolean + nilai publik) — tidak pernah mengembalikan rahasia.
export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json(ok(await integrationStatus()))
  } catch (e) {
    if (e instanceof Error && (e.message === 'Unauthorized' || e.message === 'Forbidden')) {
      return NextResponse.json(err('Forbidden'), { status: 403 })
    }
    logError('admin/system/integrations/GET', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
