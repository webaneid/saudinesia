import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { profileSchema } from '@/lib/validators/auth'
import { upsertAddress } from '@/lib/address/prepare'
import { ok, err } from '@/lib/validators'

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
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[auth/profile]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const session = await requireSession()

    const body = await request.json()
    const parsed = profileSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Input tidak valid'), { status: 400 })
    }

    const { fullName, address } = parsed.data
    const data: Record<string, unknown> = { fullName }

    if (address) {
      const existing = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: { addressId: true } })
      const result = await upsertAddress(existing.addressId, address)
      if (!result.ok) return NextResponse.json(err(result.message), { status: 400 })
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
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[auth/profile]', error instanceof Error ? error.name : error)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
