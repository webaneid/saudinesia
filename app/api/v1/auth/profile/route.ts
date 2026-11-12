import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { onboardingRefusal } from '@/lib/auth/contact'
import { profileSchema } from '@/lib/validators/auth'
import { upsertAddress } from '@/lib/address/prepare'
import { ok } from '@/lib/validators'
import { apiErrorJson, zodFailure } from '@/lib/errors/api'

// Dipakai wizard booking (docs/arsitektur-komponen-kontak.md §5) untuk prefill Kontak
// jamaah #1 (Pemesan) dari data akun — client component, tidak bisa panggil getSession() langsung.
export async function GET() {
  try {
    const session = await requireSession()
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { email: true, phone: true, whatsapp: true },
    })
    return NextResponse.json(ok(user))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    console.error('[auth/profile]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession()
    const refusal = await onboardingRefusal(session.userId, session.role)
    if (refusal) return refusal

    const body = await request.json().catch(() => null)
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return zodFailure(parsed.error)
    }

    const { fullName, address } = parsed.data
    const data: Record<string, unknown> = { fullName }

    if (address) {
      const existing = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { addressId: true } })
      const result = await upsertAddress(existing.addressId, address)
      if (!result.ok) return apiErrorJson(result.code, 400, { field: 'address' })
      data.addressId = result.id
    }

    const user = await prisma.user.update({
      where: { id: session.userId },
      data,
      select: { id: true, phone: true, fullName: true, email: true, role: true },
    })

    return NextResponse.json(ok(user))
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return apiErrorJson('unauthorized', 401)
    }
    console.error('[auth/profile]', error instanceof Error ? error.name : error)
    return apiErrorJson('internal', 500)
  }
}
