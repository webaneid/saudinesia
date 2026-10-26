import { prisma } from '@/lib/db'

// Registry pemilik media (docs/arsitektur-media.md §2, sejajar lib/pricing/costComponentOwners.ts). Menambah produk bergambar = SATU entri di sini
// (+ `MediaField` di halaman edit dan `ProductImage` di katalog); validasi, unggah, sampul, urutan, hapus, dan presign sudah dipakai bersama.
// `mode`: featured = tepat satu foto (unggah baru MENGGANTI); gallery = banyak foto, satu bertanda sampul, maksimal `max`.
export type MediaMode = 'featured' | 'gallery'

type Owner = { mode: MediaMode; max: number; label: string; exists: (id: string) => Promise<boolean> }

const has = (q: Promise<unknown | null>) => q.then(r => r !== null)

export const MEDIA_OWNERS = {
  hotel:        { mode: 'gallery',  max: 12, label: 'Hotel',          exists: (id) => has(prisma.hotel.findUnique({ where: { id }, select: { id: true } })) },
  tour_package: { mode: 'gallery',  max: 12, label: 'Paket Ziarah',   exists: (id) => has(prisma.tourPackage.findUnique({ where: { id }, select: { id: true } })) },
  vehicle:      { mode: 'gallery',  max: 10, label: 'Kendaraan',      exists: (id) => has(prisma.transportVehicle.findUnique({ where: { id }, select: { id: true } })) },
  haji:         { mode: 'featured', max: 1,  label: 'Produk Haji',    exists: (id) => has(prisma.hajiProduct.findUnique({ where: { id }, select: { id: true } })) },
  package:      { mode: 'featured', max: 1,  label: 'Paket Umroh',    exists: (id) => has(prisma.package.findUnique({ where: { id }, select: { id: true } })) },
  catering:     { mode: 'featured', max: 1,  label: 'Paket Katering', exists: (id) => has(prisma.cateringOption.findUnique({ where: { id }, select: { id: true } })) },
  visa:         { mode: 'featured', max: 1,  label: 'Produk Visa',    exists: (id) => has(prisma.visaProduct.findUnique({ where: { id }, select: { id: true } })) },
  muthowif:     { mode: 'featured', max: 1,  label: 'Muthowif',       exists: (id) => has(prisma.muthowif.findUnique({ where: { id }, select: { id: true } })) },
  tourism_site: { mode: 'featured', max: 1,  label: 'Situs Wisata',   exists: (id) => has(prisma.tourismSite.findUnique({ where: { id }, select: { id: true } })) },
} as const satisfies Record<string, Owner>

export type MediaProductType = keyof typeof MEDIA_OWNERS
export const isMediaProductType = (v: string): v is MediaProductType => Object.prototype.hasOwnProperty.call(MEDIA_OWNERS, v)
export const ownerOf = (type: MediaProductType): Owner => MEDIA_OWNERS[type]
