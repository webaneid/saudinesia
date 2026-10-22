import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/session'
import { previewDeletion } from '@/lib/account/deletion'
import { ok, err } from '@/lib/validators'

// Pratinjau SEBELUM menghapus: apa yang akan dihapus (jumlah), dan syarat yang menghalangi. Hanya membaca.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSuperAdmin()
    const { id } = await params
    const p = await previewDeletion(id)
    if (p.kind === 'not_found') return NextResponse.json(err('Permintaan tidak ditemukan'), { status: 404 })
    if (p.kind === 'not_pending') return NextResponse.json(err('Permintaan ini sudah diproses.'), { status: 409 })
    return NextResponse.json(ok({ user: { fullName: p.user.fullName, email: p.user.email }, eligible: p.eligible, blockers: p.blockers, willErase: p.willErase }))
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/deletion-requests/[id]/preview/GET]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
