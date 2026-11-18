import { NextResponse } from 'next/server'
import { authFailureResponse } from '@/lib/admin/errors'
import { ok } from '@/lib/validators'
import { requirePayoutRecorder } from '@/lib/revenue-share/policy'
import { cashTargetOptions } from '@/lib/cash/accounts'
import { listProviderAccounts } from '@/lib/revenue-share/accounts'
import { providerBalance } from '@/lib/revenue-share/payouts'

// Pilihan formulir pencairan (Fase 13e-1): akun kas asal (tanpa QRIS), rekening Platform Provider aktif, saldo bagi hasil.
export async function GET() {
  try {
    await requirePayoutRecorder()
    const [cashAccounts, recipients, balance] = await Promise.all([cashTargetOptions(), listProviderAccounts({ activeOnly: true }), providerBalance()])
    return NextResponse.json(ok({ cashAccounts, recipients: recipients.map(a => ({ value: a.id, label: `${a.bankName} ${a.accountNumber} a.n. ${a.accountHolder}`, version: a.updatedAt })), balanceIdr: balance.balanceIdr }))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/payouts/options/GET')
  }
}
