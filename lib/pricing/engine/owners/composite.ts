import { prisma } from '@/lib/db'
import { resolveMarginRule } from '../../pricingHelpers'
import { computeCostComponents, type ComponentBreakdown } from '../../costComponents'
import { computePackageBreakdown, baseTotal as packageBaseTotal } from '../../computePackagePrice'
import { computeTourPackageBreakdown, baseTotal as tourBaseTotal } from '../../computeTourPackagePrice'
import type { PriceOwner, ResolvedVariant } from '../types'
import { cheapestVariantCost, nums, pointCost } from './shared'

// Produk komposit (Haji, Paket Umroh, Paket Ziarah): jual = Σ jual PER KOMPONEN Komponen Biaya + bagian sub-modul yang `included` (apa adanya, harga tersimpan).
// Modal = Σ HPP komponen + modal sub-modul yang diketahui. Bagian included yang modalnya TAK bisa dipastikan (muthowif/katering: satuan belum baku; titik
// harga sub-modul tanpa modal) membuat modal paket null ("belum lengkap") — lebih jujur daripada untung yang tampak terlalu besar.

type Part = { price: number | null; cost: () => Promise<number | null> } // price ≤ 0/null = bagian tidak ikut

/** Σ modal bagian; null bila ada bagian ikut-harga yang modalnya tak diketahui. */
async function partsCost(parts: Part[]): Promise<number | null> {
  let total = 0
  for (const p of parts) {
    if (p.price == null || p.price <= 0) continue
    const c = await p.cost()
    if (c == null) return null
    total += c
  }
  return total
}

async function build(ownerType: 'package' | 'tour_package' | 'haji', components: ComponentBreakdown[], autoSell: number, parts: Part[]): Promise<ResolvedVariant[]> {
  const { defaultMarginPercent, roundingIncrement } = await resolveMarginRule(ownerType)
  const componentCost = components.reduce((s, c) => s + c.hppRupiah, 0)
  const partCost = await partsCost(parts)
  // Tanpa satu pun komponen maupun bagian bermodal → belum ada modal sama sekali.
  const hasAnyCost = components.length > 0 || parts.some(p => (p.price ?? 0) > 0)
  return [{
    variantKey: '', unit: 'package',
    costIdr: hasAnyCost && partCost != null ? componentCost + partCost : null,
    autoSellIdr: autoSell, // komposit SELALU punya titik harga (juga bernilai 0), seperti cache lama
    marginPctUsed: defaultMarginPercent, roundingUsed: roundingIncrement,
    fxRateIds: nums(components.map(c => c.rateId)), vendorIds: nums(components.map(c => c.vendorId)),
  }]
}

export const hajiOwner: PriceOwner = {
  ownerType: 'haji', unit: 'package', creatableVariants: [{ key: '', unit: 'package' }], dependsOnOthers: false, prunes: false,
  // Semua produk (termasuk nonaktif): produk yang diaktifkan kembali tidak boleh tampil dengan harga basi (perilaku lama).
  listIds: async () => (await prisma.hajiProduct.findMany({ select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.hajiProduct.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.hajiProduct.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, year: true } })
    return new Map(rows.map(r => [r.id, { label: `${r.name} (${r.year})`, href: `/admin/products/haji/${r.id}` }]))
  },
  resolve: async id => {
    const { components, totalSellPrice } = await computeCostComponents('haji', id)
    return build('haji', components, totalSellPrice, [])
  },
}

export const packageOwner: PriceOwner = {
  ownerType: 'package', unit: 'package', creatableVariants: [{ key: '', unit: 'package' }], dependsOnOthers: true, prunes: false,
  listIds: async () => (await prisma.package.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    return new Map(rows.map(r => [r.id, { label: r.name, href: `/admin/products/packages/${r.id}` }]))
  },
  resolve: async id => {
    const b = await computePackageBreakdown(id)
    const included = <T,>(mode: string, v: T | null | undefined) => (mode === 'included' ? v ?? null : null)
    const parts: Part[] = [
      {
        price: b.hotelMakkahMode === 'included' ? b.hotelMakkah?.totalPrice ?? null : null,
        cost: async () => {
          const h = b.hotelMakkah
          const c = h ? await pointCost('hotel', h.scheduleId) : null
          return h && c != null ? h.nights * h.numRooms * c : null
        },
      },
      {
        price: b.hotelMadinahMode === 'included' ? b.hotelMadinah?.totalPrice ?? null : null,
        cost: async () => {
          const h = b.hotelMadinah
          const c = h ? await pointCost('hotel', h.scheduleId) : null
          return h && c != null ? h.nights * h.numRooms * c : null
        },
      },
      { price: included(b.transportMode, b.includedTransportPrice), cost: () => (b.includedTransportPricingId ? pointCost('transport', b.includedTransportPricingId) : Promise.resolve(null)) },
      { price: included(b.muthowifMode, b.includedMuthowifPrice), cost: async () => null }, // satuan muthowif dalam paket belum baku → modal belum lengkap
      { price: included(b.visaMode, b.includedVisaPrice), cost: () => (b.includedVisaProductId ? cheapestVariantCost('visa', b.includedVisaProductId) : Promise.resolve(null)) },
      { price: included(b.flightMode, b.includedFlightPrice), cost: () => (b.includedFlightScheduleId ? pointCost('flight', b.includedFlightScheduleId) : Promise.resolve(null)) },
      { price: included(b.cateringMode, b.includedCateringPrice), cost: async () => null }, // katering belum bermodal (Fase 3)
    ]
    return build('package', b.components, packageBaseTotal(b), parts)
  },
}

export const tourPackageOwner: PriceOwner = {
  ownerType: 'tour_package', unit: 'package', creatableVariants: [{ key: '', unit: 'package' }], dependsOnOthers: true, prunes: false,
  listIds: async () => (await prisma.tourPackage.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.tourPackage.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.tourPackage.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    return new Map(rows.map(r => [r.id, { label: r.name, href: `/admin/products/tour-packages/${r.id}` }]))
  },
  resolve: async id => {
    const b = await computeTourPackageBreakdown(id)
    const tp = await prisma.tourPackage.findUniqueOrThrow({
      where: { id },
      select: { hotelMode: true, hotels: { select: { hotelRoomScheduleId: true, nights: true, numRooms: true, pricePerNight: true } } },
    })
    const hotelParts: Part[] = tp.hotelMode === 'included'
      ? tp.hotels.map(h => ({
          price: h.nights * h.numRooms * Number(h.pricePerNight),
          cost: async () => {
            const c = await pointCost('hotel', h.hotelRoomScheduleId)
            return c == null ? null : h.nights * h.numRooms * c
          },
        }))
      : []
    const parts: Part[] = [
      { price: b.transportMode === 'included' ? b.includedTransportPrice : null, cost: () => (b.includedTransportPricingId ? pointCost('transport', b.includedTransportPricingId) : Promise.resolve(null)) },
      ...hotelParts,
    ]
    return build('tour_package', b.components, tourBaseTotal(b), parts)
  },
}
