import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { getPresignedUrl } from '@/lib/storage/minio'
import { err } from '@/lib/validators'

// Buka bukti transfer satu pembayaran: dirujuk lewat ID pembayaran (bukan kunci objek dari URL), dialihkan ke URL presigned 15 menit.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const payment = await prisma.payment.findUnique({ where: { id: id.data }, select: { buktiTransferPath: true } })
    if (!payment?.buktiTransferPath) return NextResponse.json(err('Bukti transfer tidak ditemukan'), { status: 404 })
    const res = NextResponse.redirect(await getPresignedUrl(payment.buktiTransferPath, 15 * 60))
    res.headers.set('Cache-Control', 'no-store')
    res.headers.set('Referrer-Policy', 'no-referrer')
    return res
  } catch (e) {
    return authFailureResponse(e, 'admin/payments/[id]/bukti')
  }
}
