import { NextResponse } from 'next/server'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { providerBankAccountSchema } from '@/lib/validators/revenueShare'
import { requirePlatformProvider, requireSuperAdmin } from '@/lib/auth/session'
import { createProviderAccount, listProviderAccounts, ProviderAccountError } from '@/lib/revenue-share/accounts'

// Rekening Platform Provider (Fase 13e-1, §5e). Baca: superadmin (klien mentransfer ke sini). Ubah: HANYA akun Platform Provider.
export async function GET() {
  try {
    await requireSuperAdmin()
    return NextResponse.json(ok(await listProviderAccounts()))
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/accounts/GET')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requirePlatformProvider()
    const parsed = providerBankAccountSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const a = await createProviderAccount(parsed.data, session.userId)
    return NextResponse.json(ok(a), { status: 201 })
  } catch (e) {
    if (e instanceof ProviderAccountError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/system/platform-provider/accounts/POST')
  }
}
