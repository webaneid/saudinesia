import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { activeFields, pilgrimCatalog, type PilgrimFieldDef } from './catalog'
import { enabledProducts } from './products'
import { productRefKey, type ProductRef } from './owners'

// Kolom data jamaah yang DIMINTA dari tiap jamaah booking (docs/arsitektur-data-jamaah.md §3.3) — SATU aturan untuk halaman jamaah,
// admin, kelengkapan, dan gerbang "Ajukan" (menggantikan pilihan lama "kolom visa-nya atau set core"):
// - semua kolom AKTIF katalog bila ada produk ber-saklar nyala yang berlaku untuk jamaah itu, selain itu TIDAK ADA (keputusan pemilik K2);
// - produk melekat per jamaah (visa-nya, Paket Umroh/Haji tempat ia anggota) → hanya jamaah itu;
// - produk tingkat booking (hotel, transport, pesawat, ziarah, katering, muthowif) → jamaah di rombongan item itu (item tanpa rombongan → semua).

type Db = typeof prisma | Prisma.TransactionClient

export type PilgrimFieldSet = {
  /** Kolom yang diminta (wajib/tidaknya dari katalog). Kosong = jamaah ini tak punya kewajiban data. */
  demanded: PilgrimFieldDef[]
  /** Seluruh katalog — untuk tampilan (`displayFields`) dan pengikat kartu. */
  catalog: PilgrimFieldDef[]
}

type ItemRef = ProductRef & { groupId: string | null }

/** Produk tingkat booking per booking (dengan rombongan item). */
async function bookingItemProducts(db: Db, bookingIds: readonly string[]): Promise<Map<string, ItemRef[]>> {
  const where = { bookingId: { in: [...bookingIds] } }
  const [hotels, transports, flights, tours, caterings, muthowifs] = await Promise.all([
    db.bookingHotel.findMany({ where, select: { bookingId: true, groupId: true, hotelRoomSchedule: { select: { period: { select: { hotelId: true } } } } } }),
    db.bookingTransport.findMany({ where, select: { bookingId: true, groupId: true, transportQuota: { select: { pricing: { select: { tripId: true } } } } } }),
    db.bookingFlight.findMany({ where, select: { bookingId: true, groupId: true, flightScheduleId: true } }),
    db.bookingTourPackage.findMany({ where, select: { bookingId: true, groupId: true, tourPackageId: true } }),
    db.bookingCatering.findMany({ where, select: { bookingId: true, groupId: true, cateringOptionId: true } }),
    db.bookingMuthowif.findMany({ where, select: { bookingId: true, groupId: true } }),
  ])
  // Layanan muthowif = satu baris tunggal (MuthowifServicePrice); saklarnya melekat ke baris itu.
  const service = muthowifs.length > 0 ? await db.muthowifServicePrice.findFirst({ select: { id: true } }) : null
  const out = new Map<string, ItemRef[]>()
  const add = (bookingId: string, r: ItemRef) => out.set(bookingId, [...(out.get(bookingId) ?? []), r])
  for (const h of hotels) add(h.bookingId, { productType: 'hotel', productId: h.hotelRoomSchedule.period.hotelId, groupId: h.groupId })
  for (const t of transports) add(t.bookingId, { productType: 'transport', productId: t.transportQuota.pricing.tripId, groupId: t.groupId })
  for (const f of flights) add(f.bookingId, { productType: 'flight', productId: f.flightScheduleId, groupId: f.groupId })
  for (const t of tours) add(t.bookingId, { productType: 'tour_package', productId: t.tourPackageId, groupId: t.groupId })
  for (const c of caterings) add(c.bookingId, { productType: 'catering', productId: c.cateringOptionId, groupId: c.groupId })
  if (service) for (const m of muthowifs) add(m.bookingId, { productType: 'muthowif', productId: service.id, groupId: m.groupId })
  return out
}

/** Kolom yang diminta + katalog untuk setiap jamaah booking di `pilgrimIds`. Jamaah yang tak ditemukan tidak ada di peta. */
export async function pilgrimFieldSets(db: Db, pilgrimIds: readonly string[]): Promise<Map<string, PilgrimFieldSet>> {
  if (pilgrimIds.length === 0) return new Map()
  const [catalog, pilgrims] = await Promise.all([
    pilgrimCatalog(db),
    db.bookingPilgrim.findMany({
      where: { id: { in: [...pilgrimIds] } },
      select: {
        id: true, bookingId: true, groupId: true,
        bookingPackage: { select: { packageId: true } },
        bookingHaji: { select: { hajiProductId: true } },
        visaApplication: { select: { visaProductId: true } },
      },
    }),
  ])
  const items = await bookingItemProducts(db, [...new Set(pilgrims.map(p => p.bookingId))])
  const refsOf = (p: (typeof pilgrims)[number]): ProductRef[] => [
    ...(p.bookingPackage ? [{ productType: 'package' as const, productId: p.bookingPackage.packageId }] : []),
    ...(p.bookingHaji ? [{ productType: 'haji' as const, productId: p.bookingHaji.hajiProductId }] : []),
    ...(p.visaApplication?.visaProductId ? [{ productType: 'visa' as const, productId: p.visaApplication.visaProductId }] : []),
    ...(items.get(p.bookingId) ?? []).filter(i => i.groupId === null || i.groupId === p.groupId),
  ]
  const refsByPilgrim = new Map(pilgrims.map(p => [p.id, refsOf(p)]))
  const enabled = await enabledProducts(db, [...new Map([...refsByPilgrim.values()].flat().map(r => [productRefKey(r), { productType: r.productType, productId: r.productId }])).values()])
  const active = activeFields(catalog)
  return new Map(pilgrims.map(p => [p.id, {
    demanded: (refsByPilgrim.get(p.id) ?? []).some(r => enabled.has(productRefKey(r))) ? active : [],
    catalog,
  }]))
}

/** Satu jamaah (pembungkus `pilgrimFieldSets`). */
export async function pilgrimFieldSet(db: Db, pilgrimId: string): Promise<PilgrimFieldSet> {
  return (await pilgrimFieldSets(db, [pilgrimId])).get(pilgrimId) ?? { demanded: [], catalog: await pilgrimCatalog(db) }
}
