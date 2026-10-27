import { prisma } from '@/lib/db'
import type { PriceOwner, StoredVariant } from '../types'
import { resolveSingle } from './shared'

// Modul dasar satu-varian: Tiket Pesawat, Hotel (jadwal kamar), Transport (rute×kendaraan), Muthowif (singleton).
// Modal = ProductCost × kurs; jual = margin tipe produk → pembulatan (computeSellPrice). Kolom lama (`price`) ditulis ganda.

const sellOf = (stored: StoredVariant[]) => stored.find(v => v.variantKey === '')?.sellIdr

export const flightOwner: PriceOwner = {
  ownerType: 'flight', dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.flightSchedule.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.flightSchedule.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  resolve: id => resolveSingle('flight', id, 'person'),
  adoptLegacy: async id => {
    const r = await prisma.flightSchedule.findUnique({ where: { id }, select: { price: true } })
    return r ? Number(r.price) : null
  },
  writeLegacy: async (tx, id, stored) => {
    const price = sellOf(stored)
    if (price !== undefined) await tx.flightSchedule.update({ where: { id }, data: { price } })
  },
}

export const hotelOwner: PriceOwner = {
  ownerType: 'hotel', dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.hotelRoomSchedule.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.hotelRoomSchedule.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  resolve: id => resolveSingle('hotel', id, 'room_night'),
  adoptLegacy: async id => {
    const r = await prisma.hotelRoomSchedule.findUnique({ where: { id }, select: { price: true } })
    return r ? Number(r.price) : null
  },
  writeLegacy: async (tx, id, stored) => {
    const price = sellOf(stored)
    if (price !== undefined) await tx.hotelRoomSchedule.update({ where: { id }, data: { price } })
  },
}

export const transportOwner: PriceOwner = {
  ownerType: 'transport', dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.transportPricing.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.transportPricing.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  resolve: id => resolveSingle('transport', id, 'vehicle'),
  adoptLegacy: async id => {
    const r = await prisma.transportPricing.findUnique({ where: { id }, select: { price: true } })
    return r ? Number(r.price) : null
  },
  writeLegacy: async (tx, id, stored) => {
    const price = sellOf(stored)
    if (price !== undefined) await tx.transportPricing.update({ where: { id }, data: { price } })
  },
}

// Tarif layanan muthowif dirancang SINGLETON (docs/arsitektur-muthowif.md §10), tetapi tabelnya tidak menjaga itu (data dev punya dua baris: sisa seed + baris
// yang berbiaya). Mesin menghitung SETIAP baris dengan biayanya sendiri (deterministik) — tidak memilih satu lewat `findFirst()` tanpa urutan seperti kode lama,
// yang diam-diam menyegarkan baris yang salah dan membiarkan baris berbiaya basi.
export const muthowifOwner: PriceOwner = {
  ownerType: 'muthowif', dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.muthowifServicePrice.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(r => r.id),
  existing: async ids => (await prisma.muthowifServicePrice.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  resolve: id => resolveSingle('muthowif', id, 'person_day'),
  adoptLegacy: async id => {
    const r = await prisma.muthowifServicePrice.findUnique({ where: { id }, select: { price: true } })
    return r ? Number(r.price) : null
  },
  writeLegacy: async (tx, id, stored) => {
    const price = sellOf(stored)
    if (price !== undefined) await tx.muthowifServicePrice.update({ where: { id }, data: { price } })
  },
}
