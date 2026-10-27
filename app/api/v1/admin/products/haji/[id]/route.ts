import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireManager } from '@/lib/auth/session'
import { ok, err } from '@/lib/validators'
import { hajiProductUpdateSchema } from '@/lib/validators/adminUpdates'
import { emptyToNull } from '@/lib/validators/richText'
import { authFailureResponse, isRecordNotFound } from '@/lib/admin/errors'
import { deleteOrDeactivateHaji } from '@/lib/haji/delete'
import { sellPrice } from '@/lib/pricing/engine/read'

type Ctx = { params: Promise<{ id: string }> }

// CRUD lengkap produk Haji (docs/arsitektur-komponen-biaya.md §3.3): GET (satu produk + jumlah booking), PUT (koreksi bidang apa pun, termasuk
// mengaktifkan kembali), DELETE (hapus sungguhan bila belum pernah dipesan, selain itu nonaktif — lihat lib/haji/delete.ts).

export async function GET(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const product = await prisma.hajiProduct.findUnique({ where: { id } })
    if (!product) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
    const bookingCount = await prisma.bookingHaji.count({ where: { hajiProductId: id } })
    return NextResponse.json(ok({ ...product, price: await sellPrice('haji', id), bookingCount }))
  } catch (e) {
    return authFailureResponse(e, 'admin/products/haji/[id]/GET')
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const parsed = hajiProductUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json(err(parsed.error.errors[0]?.message ?? 'Data tidak valid'), { status: 400 })

    // Kuota total tidak boleh di bawah yang sudah dipesan/ditahan — pendingQuota/bookedQuota milik mesin booking.
    if (parsed.data.totalQuota !== undefined) {
      const current = await prisma.hajiProduct.findUnique({ where: { id }, select: { pendingQuota: true, bookedQuota: true } })
      if (!current) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
      if (parsed.data.totalQuota < current.pendingQuota + current.bookedQuota) {
        return NextResponse.json(err('Kuota total tidak boleh lebih kecil dari kuota yang sudah dipesan/ditahan'), { status: 409 })
      }
    }

    const { description, ...fields } = parsed.data
    const updated = await prisma.hajiProduct.update({
      where: { id },
      data: { ...fields, ...(description !== undefined && { description: emptyToNull(description) }) },
    })
    return NextResponse.json(ok({ ...updated, price: await sellPrice('haji', id) }))
  } catch (e) {
    if (isRecordNotFound(e)) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
    return authFailureResponse(e, 'admin/products/haji/[id]/PUT')
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await requireManager()
    const { id } = await params
    const result = await deleteOrDeactivateHaji(id)
    if (!result.found) return NextResponse.json(err('Produk haji tidak ditemukan'), { status: 404 })
    if (result.deleted) return NextResponse.json(ok({ deleted: true }))
    return NextResponse.json(ok({
      deleted: false,
      deactivated: true,
      bookingCount: result.bookingCount,
      message: `Produk sudah punya ${result.bookingCount} booking sehingga tidak dihapus — produk dinonaktifkan (tidak tampil di katalog) dan data booking tetap aman.`,
    }))
  } catch (e) {
    return authFailureResponse(e, 'admin/products/haji/[id]/DELETE')
  }
}
