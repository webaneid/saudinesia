import { NextResponse } from 'next/server'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok } from '@/lib/validators'
import { requireCashTransfer } from '@/lib/pricing/policy'
import { transferAccountOptions } from '@/lib/cash/transfers'

// Pilihan akun formulir transfer + saldo buku kas saat ini (§10.14 Fase 12b). Manager + superadmin. Hanya nama/nomor rekening perusahaan.
export async function GET() {
  try {
    await requireCashTransfer()
    return NextResponse.json(ok(await transferAccountOptions()), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/finance/transfers/options/GET')
  }
}
