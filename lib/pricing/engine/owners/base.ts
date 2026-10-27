import { prisma } from '@/lib/db'
import type { PriceOwner, StoredVariant } from '../types'
import { resolveSingle } from './shared'

// Modul dasar satu-varian: Tiket Pesawat, Hotel (jadwal kamar), Transport (rute×kendaraan), Muthowif (singleton).
// Modal = ProductCost × kurs; jual = margin tipe produk → pembulatan (computeSellPrice). Kolom lama (`price`) ditulis ganda.

const sellOf = (stored: StoredVariant[]) => stored.find(v => v.variantKey === '')?.sellIdr

export const flightOwner: PriceOwner = {
  ownerType: 'flight', unit: 'person', creatableVariants: [{ key: '', unit: 'person' }], dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.flightSchedule.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.flightSchedule.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.flightSchedule.findMany({ where: { id: { in: ids } }, include: { route: true } })
    return new Map(rows.map(r => [r.id, { label: `Tiket ${r.route.origin} → ${r.route.destination} (${r.departureFrom.toISOString().slice(0, 10)})`, href: `/admin/products/flight/${r.id}` }]))
  },
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
  ownerType: 'hotel', unit: 'room_night', creatableVariants: [{ key: '', unit: 'room_night' }], dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.hotelRoomSchedule.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.hotelRoomSchedule.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.hotelRoomSchedule.findMany({ where: { id: { in: ids } }, include: { roomType: true, period: { include: { hotel: true } } } })
    return new Map(rows.map(r => [r.id, { label: `${r.period.hotel.name} — ${r.roomType.name} (${r.period.periodStart.toISOString().slice(0, 10)} s/d ${r.period.periodEnd.toISOString().slice(0, 10)})`, href: `/admin/products/hotels/${r.period.hotelId}` }]))
  },
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
  ownerType: 'transport', unit: 'vehicle', creatableVariants: [{ key: '', unit: 'vehicle' }], dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.transportPricing.findMany({ where: { isActive: true }, select: { id: true } })).map(r => r.id),
  existing: async ids => (await prisma.transportPricing.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => {
    const rows = await prisma.transportPricing.findMany({ where: { id: { in: ids } }, include: { trip: true, vehicle: true } })
    return new Map(rows.map(r => [r.id, { label: `${r.trip.name} — ${r.vehicle.name}`, href: `/admin/products/transport/trips/${r.tripId}` }]))
  },
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

// Tarif layanan muthowif adalah SINGLETON (docs/arsitektur-muthowif.md §10) dan sejak Fase 3 dijaga DB (kolom `singleton` unik + CHECK) — paling banyak satu baris.
export const muthowifOwner: PriceOwner = {
  ownerType: 'muthowif', unit: 'person_day', creatableVariants: [{ key: '', unit: 'person_day' }], dependsOnOthers: false, prunes: false,
  listIds: async () => (await prisma.muthowifServicePrice.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(r => r.id),
  existing: async ids => (await prisma.muthowifServicePrice.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(r => r.id),
  describe: async ids => new Map(ids.map(id => [id, { label: 'Tarif layanan muthowif (per orang per hari)', href: '/admin/products/muthowif' }])),
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
