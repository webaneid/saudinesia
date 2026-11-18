import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authFailureResponse } from '@/lib/admin/errors'
import { err, ok } from '@/lib/validators'
import { providerBankAccountUpdateSchema } from '@/lib/validators/revenueShare'
import { requirePlatformProvider, requireSuperAdmin } from '@/lib/auth/session'
import { getProviderAccount, ProviderAccountError, removeProviderAccount, updateProviderAccount } from '@/lib/revenue-share/accounts'

// Rekening Platform Provider (Fase 13e-1): baca superadmin; ubah/hapus HANYA akun Platform Provider. Hapus aman (dipakai pencairan → nonaktif).
type Ctx = { params: Promise<{ id: string }> }
const notFound = () => NextResponse.json(err('Rekening tidak ditemukan'), { status: 404 })

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const session = await requireSuperAdmin()
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return notFound()
    const a = await getProviderAccount(id.data)
    return a ? NextResponse.json(ok({ ...a, canEdit: session.isPlatformProvider })) : notFound()
  } catch (e) {
    return authFailureResponse(e, 'admin/system/platform-provider/accounts/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const session = await requirePlatformProvider()
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return notFound()
    const parsed = providerBankAccountUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.issues[0]?.message ?? 'Data tidak valid'), { status: 400 })
    return NextResponse.json(ok(await updateProviderAccount(id.data, parsed.data, session.userId)))
  } catch (e) {
    if (e instanceof ProviderAccountError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/system/platform-provider/accounts/[id]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const session = await requirePlatformProvider()
    const id = z.uuid().safeParse((await params).id)
    if (!id.success) return notFound()
    return NextResponse.json(ok(await removeProviderAccount(id.data, session.userId)))
  } catch (e) {
    if (e instanceof ProviderAccountError) return NextResponse.json(err(e.message), { status: e.status })
    return authFailureResponse(e, 'admin/system/platform-provider/accounts/[id]/DELETE')
  }
}
