import { prisma } from '@/lib/db'
import { repriceOwner, repriceOwnerType } from './engine'

// Pembungkus tipis (Fase 1 harga terpadu): tarif layanan muthowif (singleton) dihitung & disimpan mesin `lib/pricing/engine` (titik harga `muthowif` +
// penulisan ganda ke `MuthowifServicePrice.price`). Nama lama dipertahankan; dihapus di Fase 5.

/** Hitung ulang tarif layanan muthowif — dipanggil saat ProductCost/PreferredVendor/PricingRule singleton ini berubah. */
export async function refreshMuthowifServicePriceCache(): Promise<void> {
  const servicePrice = await prisma.muthowifServicePrice.findFirst({ select: { id: true } })
  if (servicePrice) await repriceOwner('muthowif', servicePrice.id)
}

export async function refreshAllMuthowifServicePriceCaches(currencies?: string[]): Promise<void> {
  await repriceOwnerType('muthowif', currencies)
}
