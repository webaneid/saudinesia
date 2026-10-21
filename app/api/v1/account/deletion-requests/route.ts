import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'

export async function GET() {
  try {
    const session = await requireSession()
    const request = await prisma.accountDeletionRequest.findFirst({
      where: { userId: session.userId },
      orderBy: { requestedAt: 'desc' },
    })
    return NextResponse.json(ok(request))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[account/deletion-requests/GET]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST() {
  try {
    const session = await requireSession()
    const pending = await prisma.accountDeletionRequest.findFirst({
      where: { userId: session.userId, status: 'pending' },
    })
    if (pending) {
      return NextResponse.json(err('Anda sudah punya permintaan hapus akun yang sedang diproses.'), { status: 409 })
    }
    const request = await prisma.accountDeletionRequest.create({
      data: { userId: session.userId },
    })
    return NextResponse.json(ok(request), { status: 201 })
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json(err('Unauthorized'), { status: 401 })
    }
    console.error('[account/deletion-requests/POST]', e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
