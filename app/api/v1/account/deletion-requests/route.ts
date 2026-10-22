import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/auth/session'
import { consume, policy, tooManyRequests } from '@/lib/auth/rateLimit'
import { MIN_WAIT_HOURS, submitDeletionRequest, withdrawDeletionRequest } from '@/lib/account/deletion'
import { ok, err } from '@/lib/validators'

// Pengajuan/penarikan permintaan hapus akun UU PDP oleh pemilik akun (docs/arsitektur-hapus-akun.md). Pemrosesan hanya oleh superadmin.

function unauthorized(e: unknown): NextResponse | null {
  return e instanceof Error && e.message === 'Unauthorized' ? NextResponse.json(err('Unauthorized'), { status: 401 }) : null
}

export async function GET() {
  try {
    const session = await requireSession()
    // select eksplisit: `note` adalah catatan internal admin (bukan untuk jamaah), `processedById`/`erasureSummary` juga tidak perlu (DEL-05).
    const request = await prisma.accountDeletionRequest.findFirst({
      where: { userId: session.userId },
      orderBy: { requestedAt: 'desc' },
      select: { status: true, requestedAt: true, processedAt: true },
    })
    return NextResponse.json(ok(request ? { ...request, minWaitHours: MIN_WAIT_HOURS } : null))
  } catch (e) {
    const u = unauthorized(e); if (u) return u
    console.error('[account/deletion-requests/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

export async function POST() {
  try {
    const session = await requireSession()
    // Hanya jamaah: staf/agen dikeluarkan dengan menonaktifkan akun (SEC-18), dan penghapusan jamaah tidak boleh menyentuh akun staf.
    if (session.role !== 'pilgrim') return NextResponse.json(err('Forbidden'), { status: 403 })
    const limit = await consume(policy('deletionRequestUser', session.userId))
    if (!limit.allowed) return tooManyRequests(limit.retryAfterSec)

    const created = await submitDeletionRequest(session.userId)
    if (!created.ok) {
      return created.reason === 'gone'
        ? NextResponse.json(err('Unauthorized'), { status: 401 })
        : NextResponse.json(err('Anda sudah punya permintaan hapus akun yang sedang diproses.'), { status: 409 })
    }
    return NextResponse.json(ok({ ...created.request, minWaitHours: MIN_WAIT_HOURS }), { status: 201 })
  } catch (e) {
    const u = unauthorized(e); if (u) return u
    console.error('[account/deletion-requests/POST]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}

/** Menarik permintaan yang masih pending (hak menarik persetujuan). Klaim atomik: tidak bisa menyalip pemrosesan yang sedang berjalan. */
export async function DELETE() {
  try {
    const session = await requireSession()
    if (!(await withdrawDeletionRequest(session.userId))) return NextResponse.json(err('Tidak ada permintaan yang bisa ditarik.'), { status: 409 })
    return NextResponse.json(ok({ status: 'withdrawn' }))
  } catch (e) {
    const u = unauthorized(e); if (u) return u
    console.error('[account/deletion-requests/DELETE]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
