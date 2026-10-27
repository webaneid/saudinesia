import { prisma } from '@/lib/db'
import type { PriceOwner, StoredVariant } from '../types'

// Pemilik MANUAL-ONLY (docs/arsitektur-harga-terpadu.md §16): harga jual (dan modal, opsional) diisi admin langsung di PriceCard — tidak ada perhitungan dari
// Komponen Biaya, jadi hitung-ulang tak menyentuhnya. Kolom lama ditulis ganda dari titik harga sampai Fase 5.

export const CATERING_SEASONS = ['regular', 'ramadan', 'hajj'] as const
export const cateringVariantKey = (season: (typeof CATERING_SEASONS)[number]) => `season:${season}`

export const cateringOwner: PriceOwner = {
  ownerType: 'catering', unit: 'person_day', manualOnly: true,
  creatableVariants: CATERING_SEASONS.map(s => ({ key: cateringVariantKey(s), unit: 'person_day' as const })),
  dependsOnOthers: false, prunes: false,
  listIds: async () => [],
  existing: async ids => (await prisma.cateringOption.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.cateringOption.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    return new Map(rows.map(r => [r.id, { label: `Katering — ${r.name}`, href: `/admin/products/catering/${r.id}` }]))
  },
  resolve: async () => [],
  adoptLegacy: async () => null,
  writeLegacy: async (tx, id, stored: StoredVariant[]) => {
    const by = new Map(stored.map(v => [v.variantKey, v.sellIdr]))
    const data = {
      ...(by.has('season:regular') ? { pricePerPersonRegular: by.get('season:regular')! } : {}),
      ...(by.has('season:ramadan') ? { pricePerPersonRamadan: by.get('season:ramadan')! } : {}),
      ...(by.has('season:hajj') ? { pricePerPersonHajj: by.get('season:hajj')! } : {}),
    }
    if (Object.keys(data).length > 0) await tx.cateringOption.update({ where: { id }, data })
  },
}

export const hotelServiceOwner: PriceOwner = {
  ownerType: 'hotel_service', unit: 'service', manualOnly: true,
  creatableVariants: [{ key: '', unit: 'service' }],
  dependsOnOthers: false, prunes: false,
  listIds: async () => [],
  existing: async ids => (await prisma.hotelService.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.hotelService.findMany({ where: { id: { in: ids } }, include: { hotel: { select: { id: true, name: true } } } })
    return new Map(rows.map(r => [r.id, { label: `${r.hotel.name} — layanan ${r.serviceName}`, href: `/admin/products/hotels/${r.hotelId}` }]))
  },
  resolve: async () => [],
  adoptLegacy: async () => null,
  writeLegacy: async (tx, id, stored) => {
    const price = stored.find(v => v.variantKey === '')?.sellIdr
    if (price !== undefined) await tx.hotelService.update({ where: { id }, data: { price } })
  },
}
