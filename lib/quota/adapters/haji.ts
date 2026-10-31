import type { BookingHaji } from '@prisma/client'
import type { QuotaAdapter, Tx } from './types'
import { ItemNotBookableError } from '@/lib/booking/errors'
import { requireSellPrice } from '@/lib/pricing/engine/read'

// docs/arsitektur-booking.md §6 Step 2 — menutup Gap #1 (docs/arsitektur-umroh.md §7): HajiProduct
// sebelumnya cuma py totalQuota/bookedQuota tanpa pendingQuota, jadi Haji tidak bisa direservasi
// aman (race condition antar booking sebelum pembayaran dikonfirmasi) — pola identik
// HotelRoomSchedule (lib/quota/index.ts reserveHotelQuota/confirmHotelQuota/releaseHotelQuota).
export async function reserveHaji(tx: Tx, hajiProductId: string, numPersons: number): Promise<void> {
  const product = await tx.hajiProduct.findUniqueOrThrow({
    where: { id: hajiProductId },
    select: { totalQuota: true, pendingQuota: true, bookedQuota: true, isActive: true },
  })
  // SEC-66: produk nonaktif atau belum berharga (titik harga `haji` = hasil Komponen Biaya, tak ada/0 sampai diisi) TIDAK boleh dipesan — dulu `totalPrice = 0 × orang`
  // meloloskan booking gratis. Dicek SEBELUM kuota ditahan; transaksi booking di-rollback.
  if (!product.isActive) throw new ItemNotBookableError('Produk haji tidak tersedia')
  await requireSellPrice('haji', hajiProductId, 'produk haji', tx)
  const available = product.totalQuota - product.pendingQuota - product.bookedQuota
  if (available < numPersons) throw new Error(`Haji quota insufficient: need ${numPersons}, have ${available}`)
  await tx.hajiProduct.update({
    where: { id: hajiProductId },
    data: { pendingQuota: { increment: numPersons } },
  })
}

export const hajiAdapter: QuotaAdapter<BookingHaji> = {
  confirm: async (tx, row) => {
    await tx.hajiProduct.update({
      where: { id: row.hajiProductId },
      data: { pendingQuota: { decrement: row.numPersons }, bookedQuota: { increment: row.numPersons } },
    })
  },
  release: async (tx, row, o) => {
    await tx.hajiProduct.update({
      where: { id: row.hajiProductId },
      data: o.confirmed ? { bookedQuota: { decrement: row.numPersons } } : { pendingQuota: { decrement: row.numPersons } },
    })
  },
}
