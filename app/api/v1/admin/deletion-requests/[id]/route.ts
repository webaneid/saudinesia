import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/auth/session'
import { executeDeletion, rejectDeletion } from '@/lib/account/deletion'
import { ok, err } from '@/lib/validators'

// Memproses permintaan hapus akun UU PDP (docs/arsitektur-hapus-akun.md). `completed` MENGHAPUS/ANONIMKAN data secara permanen,
// jadi superadmin harus mengetik ulang email pemilik akun; `rejected` hanya menutup permintaan. Hanya dari `pending`.
const note = z.string().trim().max(500).nullish()
const bodySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rejected'), note }).strict(),
  z.object({ status: z.literal('completed'), note, confirmEmail: z.string().trim().min(3).max(254) }).strict(),
])

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSuperAdmin()
    const { id } = await params
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })
    const body = parsed.data

    if (body.status === 'rejected') {
      const r = await rejectDeletion(id, session.userId, body.note ?? null)
      if (r.ok) return NextResponse.json(ok({ status: 'rejected' }))
      return r.reason === 'not_found'
        ? NextResponse.json(err('Permintaan tidak ditemukan'), { status: 404 })
        : NextResponse.json(err('Permintaan ini sudah diproses.'), { status: 409 })
    }

    const r = await executeDeletion(id, session.userId, { note: body.note ?? null, confirmEmail: body.confirmEmail })
    if (r.ok) return NextResponse.json(ok({ status: 'completed', erased: r.summary }))
    switch (r.reason) {
      case 'not_found': return NextResponse.json(err('Permintaan tidak ditemukan'), { status: 404 })
      case 'not_pending': return NextResponse.json(err('Permintaan ini sudah diproses.'), { status: 409 })
      case 'confirm_mismatch': return NextResponse.json(err('Email konfirmasi tidak cocok dengan email pemilik akun.'), { status: 422 })
      case 'blocked': return NextResponse.json({ ...err('Akun belum dapat dihapus.'), meta: { blockers: r.blockers } }, { status: 422 })
      case 'storage_failed': return NextResponse.json(err('Penyimpanan dokumen gagal dihapus. Tidak ada data yang berubah — coba lagi.'), { status: 500 })
    }
  } catch (e) {
    if (e instanceof Error && e.message === 'Unauthorized') return NextResponse.json(err('Unauthorized'), { status: 401 })
    if (e instanceof Error && e.message === 'Forbidden') return NextResponse.json(err('Forbidden'), { status: 403 })
    console.error('[admin/deletion-requests/[id]/PATCH]', e instanceof Error ? e.name : e)
    return NextResponse.json(err('Internal server error'), { status: 500 })
  }
}
