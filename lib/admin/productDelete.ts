import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { purgeProductMedia } from '@/lib/media/service'
import type { MediaProductType } from '@/lib/media/owners'
import { deleteOrDeactivate, type DeleteOutcome } from '@/lib/admin/safeDelete'

// Hapus-aman produk admin yang belum punya semantiknya (docs/arsitektur-admin-editor.md §6; aturan "CRUD lengkap selalu"): hapus SUNGGUHAN hanya bila
// tak ada riwayat yang merujuk, selain itu NONAKTIF. Memakai `deleteOrDeactivate` (satu semantik); di sini ditambah tiga hal yang tak bisa diserahkan ke FK:
//  1. RUJUKAN SET NULL dihitung sebagai rujukan. FK `ON DELETE SET NULL` (penugasan muthowif, pengajuan visa, hotel pilihan di booking) tidak menolak
//     hapus — ia diam-diam MENGOSONGKAN riwayat. Hanya penghitungan eksplisit yang melindunginya.
//  2. Baris polimorfik (`productType`+`productId`: komponen biaya, vendor pilihan, syarat dokumen, field manifest, titik harga) tak punya FK — dihapus bersama
//     produknya dalam transaksi yang sama agar tak yatim.
//  3. Pemeriksaan ulang di bawah kunci baris. `SELECT … FOR UPDATE` menunggu rujukan baru yang sedang masuk (FK mengambil KEY SHARE pada baris
//     induk) dan menahan yang berikutnya, sehingga hitung → hapus tidak bisa disalip. Rujukan yang muncul jatuh ke jalur nonaktif (P2003-setara).
// Objek foto dibersihkan SETELAH commit (`purgeProductMedia`; objek MinIO tak bisa di-rollback).

type Tx = Prisma.TransactionClient
/** Nama tabel yang boleh dikunci — literal union (bukan masukan), karena identifier tak bisa di-bind. */
type LockTable = 'muthowif' | 'tourism_sites' | 'hotels' | 'packages' | 'tour_packages' | 'visa_products'

const notFound = () => Object.assign(new Error('not found'), { code: 'P2025' })
const referenced = () => Object.assign(new Error('referenced'), { code: 'P2003' })

// $queryRaw: Prisma ORM tidak punya `SELECT … FOR UPDATE`; nama tabel hanya dari union literal di atas, id di-bind.
async function lockRow(tx: Tx, table: LockTable, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`
  if (rows.length === 0) throw notFound()
}

/** Baris polimorfik milik produk (tanpa FK). Pemilik baru yang menyimpan `productType`+`productId` WAJIB ditambahkan di sini. */
async function dropPolymorphic(tx: Tx, productType: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const scope = { productType, productId: { in: ids } }
  await tx.productCost.deleteMany({ where: scope })
  await tx.preferredVendor.deleteMany({ where: scope })
  await tx.documentRequirement.deleteMany({ where: scope })
  await tx.manifestFieldRequirement.deleteMany({ where: scope })
  await tx.pricePoint.deleteMany({ where: { ownerType: productType, ownerId: { in: ids } } }) // titik harga (mesin harga) milik produk ini
}

type Spec = {
  table: LockTable
  id: string
  /** Rujukan riwayat yang mencegah hapus fisik (termasuk yang FK-nya SET NULL). */
  count: (db: Tx | typeof prisma) => Promise<number>
  /** Hapus baris + turunan di dalam transaksi terkunci. */
  drop: (tx: Tx) => Promise<void>
  deactivate: () => Promise<unknown>
  usedBy: (n: number) => string
  mediaType: MediaProductType
}

function run(s: Spec): Promise<DeleteOutcome> {
  return deleteOrDeactivate({
    references: async () => {
      await prisma.$transaction(async tx => lockRow(tx, s.table, s.id).then(() => undefined)) // 404 bila tak ada (P2025), tanpa menahan kunci
      return s.count(prisma)
    },
    remove: async () => {
      await prisma.$transaction(async tx => {
        await lockRow(tx, s.table, s.id)
        if ((await s.count(tx)) > 0) throw referenced() // rujukan masuk di antara pemeriksaan dan hapus → jalur nonaktif
        await s.drop(tx)
      })
      await purgeProductMedia(s.mediaType, s.id)
    },
    deactivate: s.deactivate,
    usedBy: s.usedBy,
  })
}

export function deleteMuthowif(id: string): Promise<DeleteOutcome> {
  return run({
    table: 'muthowif', id, mediaType: 'muthowif',
    count: db => db.bookingMuthowif.count({ where: { muthowifId: id } }), // penugasan = riwayat siapa yang bertugas (FK SET NULL akan menghapusnya)
    drop: async tx => { await tx.muthowif.delete({ where: { id } }) }, // ketersediaan ikut terhapus (CASCADE)
    deactivate: () => prisma.muthowif.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Muthowif tercatat di ${n} penugasan booking`,
  })
}

export function deleteTourismSite(id: string): Promise<DeleteOutcome> {
  return run({
    table: 'tourism_sites', id, mediaType: 'tourism_site',
    count: db => db.tourPackageSite.count({ where: { tourismSiteId: id } }),
    drop: async tx => { await tx.tourismSite.delete({ where: { id } }) },
    deactivate: () => prisma.tourismSite.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Situs dipakai di ${n} paket ziarah`,
  })
}

export function deleteTourPackage(id: string): Promise<DeleteOutcome> {
  return run({
    table: 'tour_packages', id, mediaType: 'tour_package',
    count: db => db.bookingTourPackage.count({ where: { tourPackageId: id } }),
    drop: async tx => { await dropPolymorphic(tx, 'tour_package', [id]); await tx.tourPackage.delete({ where: { id } }) }, // situs/hotel/opsi ikut (CASCADE)
    deactivate: () => prisma.tourPackage.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Paket ziarah dipesan di ${n} booking`,
  })
}

// Paket Umroh: hari ini TIDAK ada tabel booking yang merujuk `packages` (booking engine direncanakan dirombak). Penjaga CI menyidik FK masuknya —
// FK baru ke `packages` akan membuat tes merah sampai penghitungan di bawah diperbarui.
export function deletePackage(id: string): Promise<DeleteOutcome> {
  return run({
    table: 'packages', id, mediaType: 'package',
    count: async () => 0,
    drop: async tx => { await dropPolymorphic(tx, 'package', [id]); await tx.package.delete({ where: { id } }) }, // opsi hotel/visa/katering ikut (CASCADE)
    deactivate: () => prisma.package.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Paket umroh dipakai di ${n} rujukan`,
  })
}

export function deleteVisaProduct(id: string): Promise<DeleteOutcome> {
  return run({
    table: 'visa_products', id, mediaType: 'visa',
    count: async db => {
      const [applications, packageOptions, packagesIncluding] = await Promise.all([
        db.visaApplication.count({ where: { visaProductId: id } }), // FK SET NULL: pengajuan lama akan kehilangan produknya
        db.packageVisaOption.count({ where: { visaProductId: id } }),
        db.package.count({ where: { includedVisaProductId: id } }), // FK SET NULL: paket akan kehilangan visa "included"
      ])
      return applications + packageOptions + packagesIncluding
    },
    drop: async tx => { await dropPolymorphic(tx, 'visa', [id]); await tx.visaProduct.delete({ where: { id } }) },
    deactivate: () => prisma.visaProduct.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Produk visa dipakai di ${n} pesanan/pengajuan/paket`,
  })
}

export function deleteHotel(id: string): Promise<DeleteOutcome> {
  const viaSchedule = { period: { hotelId: id } }
  return run({
    table: 'hotels', id, mediaType: 'hotel',
    count: async db => {
      const sched = { hotelRoomSchedule: viaSchedule }
      const counts = await Promise.all([
        db.bookingHotel.count({ where: sched }),
        db.bookingService.count({ where: { hotelService: { hotelId: id } } }),
        db.bookingTourPackage.count({ where: { chosenHotelRoomSchedule: viaSchedule } }), // FK SET NULL: pilihan kamar di booking hilang
        db.packageHotelOption.count({ where: sched }),
        db.package.count({ where: { OR: [{ includedHotelMakkahSchedule: viaSchedule }, { includedHotelMadinahSchedule: viaSchedule }] } }), // SET NULL
        db.tourPackageHotel.count({ where: sched }),
        db.tourPackageHotelOption.count({ where: sched }),
      ])
      return counts.reduce((a, b) => a + b, 0)
    },
    drop: async tx => {
      const schedules = await tx.hotelRoomSchedule.findMany({ where: viaSchedule, select: { id: true } })
      await dropPolymorphic(tx, 'hotel', [id, ...schedules.map(s => s.id)]) // harga/vendor per jadwal kamar (productId = id jadwal)
      const services = await tx.hotelService.findMany({ where: { hotelId: id }, select: { id: true } })
      await tx.pricePoint.deleteMany({ where: { ownerType: 'hotel_service', ownerId: { in: services.map(s => s.id) } } }) // layanan ikut terhapus (CASCADE) — titik harganya tak punya FK
      const hotel = await tx.hotel.findUnique({ where: { id }, select: { addressId: true } })
      await tx.hotel.delete({ where: { id } }) // periode, jadwal kamar, layanan ikut (CASCADE)
      if (hotel?.addressId) await tx.address.delete({ where: { id: hotel.addressId } }) // alamat 1:1 milik hotel
    },
    deactivate: () => prisma.hotel.update({ where: { id }, data: { isActive: false } }),
    usedBy: n => `Hotel dipakai di ${n} booking/paket`,
  })
}
