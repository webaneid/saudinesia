import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok, err } from '@/lib/validators'
import { invoiceSettingsSchema } from '@/lib/validators/invoiceSettings'
import { getInvoiceSettings, SettingsError, updateInvoiceSettings } from '@/lib/invoice/settings'
import { logError } from '@/lib/log'

// Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6) — hanya superadmin (area Sistem). Satu baris 'global'.
export async function GET() {
  let session
  try { session = await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/system/invoice-settings/GET') }
  void session
  try { return NextResponse.json(ok(await getInvoiceSettings())) } catch (e) {
    logError('admin/system/invoice-settings/GET', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(req: Request) {
  let session
  try { session = await requireSuperAdmin() } catch (e) { return authFailureResponse(e, 'admin/system/invoice-settings/PUT') }
  const parsed = invoiceSettingsSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
  try { return NextResponse.json(ok(await updateInvoiceSettings(parsed.data, session.userId))) } catch (e) {
    if (e instanceof SettingsError) return NextResponse.json(err(e.message), { status: e.status })
    logError('admin/system/invoice-settings/PUT', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
