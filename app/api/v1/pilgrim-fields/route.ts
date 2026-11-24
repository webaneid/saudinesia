import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { logError } from '@/lib/log'
import { getSession } from '@/lib/auth/session'
import { cardExtraFields, pilgrimCatalog } from '@/lib/pilgrim-data/catalog'

// Kolom buatan admin yang diisi di kartu jamaah (docs/arsitektur-data-jamaah.md §3.4, D4) — definisi kolom saja (bukan data pribadi), untuk
// formulir kartu `SavedPilgrimFields` di Jamaah Saya dan di admin atas nama pelanggan. Butuh sesi (pelanggan atau staf).
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return apiErrorJson('unauthorized', 401)
    const fields = cardExtraFields(await pilgrimCatalog()).map(({ id, fieldKey, label, fieldType, options, required, role, order }) => ({ id, fieldKey, label, fieldType, options, required, role, order }))
    return NextResponse.json(ok(fields))
  } catch (e) {
    logError('pilgrim-fields/GET', e)
    return apiErrorJson('internal', 500)
  }
}
