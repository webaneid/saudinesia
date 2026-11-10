import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/auth/session'
import { authFailureResponse } from '@/lib/admin/errors'
import { getPresignedUrl } from '@/lib/storage/minio'
import { err, ok } from '@/lib/validators'

// Bukti transfer satu pembayaran: dirujuk lewat ID pembayaran (bukan kunci objek dari URL) → `{ url, mimeType }` (URL presigned 15 menit),
// ditampilkan di popup admin (components/shared/documents/FileViewerDialog) — bukan dialihkan ke tab baru. Jenis dari ekstensi kunci yang ditulis server.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
    const id = z.string().uuid().safeParse((await params).id)
    if (!id.success) return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    const payment = await prisma.payment.findUnique({ where: { id: id.data }, select: { buktiTransferPath: true } })
    if (!payment?.buktiTransferPath) return NextResponse.json(err('Bukti transfer tidak ditemukan'), { status: 404 })
    const url = await getPresignedUrl(payment.buktiTransferPath, 15 * 60)
    const mimeType = payment.buktiTransferPath.endsWith('.pdf') ? 'application/pdf' : 'image/webp'
    return NextResponse.json(ok({ url, mimeType }), { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  } catch (e) {
    return authFailureResponse(e, 'admin/payments/[id]/bukti')
  }
}
