import { NextResponse } from 'next/server'
import { ok } from '@/lib/validators'
import { apiErrorJson } from '@/lib/errors/api'
import { logError } from '@/lib/log'
import { getSession } from '@/lib/auth/session'
import { activeFields, cardFieldDef, pilgrimCatalog } from '@/lib/pilgrim-data/catalog'

// Kolom AKTIF katalog Data Jamaah (docs/arsitektur-data-jamaah.md §3.4) — definisi kolom saja (bukan data pribadi), untuk formulir kartu
// `SavedPilgrimFields` di Jamaah Saya, Profil, popup booking, dan admin atas nama pelanggan. Butuh sesi (pelanggan atau staf).
export async function GET() {
  try {
    const session = await getSession()
    if (!session) return apiErrorJson('unauthorized', 401)
    return NextResponse.json(ok(activeFields(await pilgrimCatalog()).map(cardFieldDef)))
  } catch (e) {
    logError('pilgrim-fields/GET', e)
    return apiErrorJson('internal', 500)
  }
}
