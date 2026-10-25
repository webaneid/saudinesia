import { prisma } from '@/lib/db'
import { refreshPackagePriceCache } from './refreshPackagePriceCache'
import { refreshTourPackagePriceCache } from './refreshTourPackagePriceCache'

// Registry pemilik Komponen Biaya (docs/arsitektur-komponen-biaya.md §3.1). Modul baru = satu entri di sini + dua berkas route tipis.
export type CostOwner = {
  productType: string // nilai `ProductCost.productType` — juga kunci margin (`PricingRule`)
  routeBase: string   // segmen URL admin, hanya untuk tag log
  exists: (id: string) => Promise<boolean>
  refresh: (id: string) => Promise<void> // hitung ulang cache harga pemilik setelah komponennya berubah
}

export const COST_OWNERS = {
  package: {
    productType: 'package',
    routeBase: 'packages',
    exists: async (id) => (await prisma.package.findUnique({ where: { id }, select: { id: true } })) !== null,
    refresh: refreshPackagePriceCache,
  },
  tour_package: {
    productType: 'tour_package',
    routeBase: 'tour-packages',
    exists: async (id) => (await prisma.tourPackage.findUnique({ where: { id }, select: { id: true } })) !== null,
    refresh: refreshTourPackagePriceCache,
  },
} as const satisfies Record<string, CostOwner>

export type CostOwnerKey = keyof typeof COST_OWNERS
