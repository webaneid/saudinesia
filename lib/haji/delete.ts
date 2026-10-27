import { purgeProductMedia } from '@/lib/media/service'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

export type HajiDeleteResult =
  | { found: false }
  | { found: true; deleted: true }
  | { found: true; deleted: false; bookingCount: number }

/**
 * Hapus produk Haji dengan semantik aman (arahan pemilik 2026-10-26: CRUD lengkap, "kita ini manusia, bisa salah"):
 *  - belum pernah dipesan → HAPUS SUNGGUHAN dalam satu transaksi, beserta baris polimorfik miliknya (komponen biaya, vendor pilihan,
 *    syarat dokumen, field manifest) yang tidak punya FK sehingga akan menjadi yatim;
 *  - sudah ada booking → NONAKTIFKAN (booking, invoice, dan kuota tak boleh yatim) dan beri tahu pemanggil jumlah bookingnya.
 * Booking yang masuk di antara pemeriksaan dan penghapusan ditangkap FK (P2003) lalu jatuh ke jalur nonaktif.
 */
export async function deleteOrDeactivateHaji(id: string): Promise<HajiDeleteResult> {
  const deactivate = async (bookingCount: number): Promise<HajiDeleteResult> => {
    await prisma.hajiProduct.update({ where: { id }, data: { isActive: false } })
    return { found: true, deleted: false, bookingCount }
  }

  try {
    const result = await prisma.$transaction(async (tx): Promise<HajiDeleteResult> => {
      const product = await tx.hajiProduct.findUnique({ where: { id }, select: { id: true } })
      if (!product) return { found: false }
      const bookingCount = await tx.bookingHaji.count({ where: { hajiProductId: id } })
      if (bookingCount > 0) {
        await tx.hajiProduct.update({ where: { id }, data: { isActive: false } })
        return { found: true, deleted: false, bookingCount }
      }
      const scope = { productType: 'haji', productId: id }
      await tx.productCost.deleteMany({ where: scope })
      await tx.preferredVendor.deleteMany({ where: scope })
      await tx.documentRequirement.deleteMany({ where: scope })
      await tx.manifestFieldRequirement.deleteMany({ where: scope })
      await tx.pricePoint.deleteMany({ where: { ownerType: 'haji', ownerId: id } })
      await tx.hajiProduct.delete({ where: { id } })
      return { found: true, deleted: true }
    })
    if (result.found && result.deleted) await purgeProductMedia('haji', id) // setelah commit: baris + objek foto ikut bersih
    return result
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      return deactivate(await prisma.bookingHaji.count({ where: { hajiProductId: id } }))
    }
    throw e
  }
}
