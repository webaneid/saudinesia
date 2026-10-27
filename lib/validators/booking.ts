import { z } from 'zod'
import { prisma } from '@/lib/db'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'

// docs/arsitektur-booking.md §6 Step 5 — items[] generik menggantikan field tetap
// (hotelMakkah/hotelMadinah/transports/muthowif/catering/tourPackages). Satu keranjang campur
// bebas: kombinasi item apa pun, jumlah bebas per tipe (bukan cuma "maks 1 hotel Makkah"). Harga
// TIDAK PERNAH diterima dari client di sini — semua dihitung ulang server-side di
// app/api/v1/bookings/route.ts dari referensi (id jadwal/kuota) yang dikirim, pola yang sama
// persis dengan skema lama, cuma disatukan jadi satu discriminated union. Visa TETAP field
// terpisah (bukan itemType) — lihat §3.3: visa selalu per-jamaah, bukan per-booking.
const bookingItemSchema = z.discriminatedUnion('itemType', [
  z.object({
    itemType: z.literal('hotel'),
    hotelRoomScheduleId: z.string().uuid(),
    checkIn:             z.string().date(),
    checkOut:            z.string().date(),
    nights:               z.number().int().min(1),
    numRooms:             z.number().int().min(1),
  }),
  z.object({
    itemType: z.literal('transport'),
    transportQuotaId: z.string().uuid(),
    numPassengers:    z.number().int().min(1),
    pickupDetail:     z.string().max(300).optional(),
    dropoffDetail:    z.string().max(300).optional(),
  }),
  z.object({
    itemType: z.literal('muthowif'),
    startDate: z.string().date(),
    endDate:   z.string().date(),
    numDays:   z.number().int().min(1),
    numPeople: z.number().int().min(1),
  }),
  z.object({
    itemType: z.literal('catering'),
    cateringOptionId: z.string().uuid(),
    startDate:        z.string().date(),
    endDate:          z.string().date(),
    numDays:          z.number().int().min(1),
    numPeople:        z.number().int().min(1),
    // `totalPrice` SENGAJA tidak ada: harga katering dihitung server dari CateringOption (lib/pricing/computeCateringPrice.ts).
  }),
  z.object({
    itemType: z.literal('tourPackage'),
    tourPackageId:             z.string().uuid(),
    transportQuotaId:          z.string().uuid().optional(),
    numPeople:                 z.number().int().min(1),
    chosenHotelRoomScheduleId: z.string().uuid().optional(),
    chosenHotelNumRooms:       z.number().int().min(1).optional(),
  }),
  // Haji BARU (docs/arsitektur-booking.md §6 Step 5) — belum ada wizard step yang mengirim ini
  // (Step 6, checkout pendek), tapi skema+adapter (Step 1-2) sudah siap menerima lewat API
  // langsung — konsisten dengan pola "registry lengkap dulu, integrasi UI menyusul".
  z.object({
    itemType: z.literal('haji'),
    hajiProductId: z.string().uuid(),
    numPersons:    z.number().int().min(1),
  }),
])

export const createBookingSchema = z.object({
  departureDate:  z.string().date(),
  returnDate:     z.string().date(),
  season:         z.enum(['regular', 'ramadan', 'hajj']),
  bookingType:    z.enum(['individual', 'group']),
  groupName:      z.string().optional(),
  // .max(500) DIHAPUS (docs/arsitektur-booking.md §1.6.2/Keputusan #9) — manifest tidak
  // dibatasi aturan bisnis, analogi booking kereta/pesawat: satu orang bisa booking untuk
  // siapa saja, jumlah tidak wajar dibatasi angka sembarang. Batas teknis wajar (bukan bisnis)
  // tetap ada lewat .max(2000) murni mencegah payload abuse.
  totalPilgrims: z.number().int().min(1).max(2000),

  items: z.array(bookingItemSchema).default([]),

  // docs/arsitektur-manifest.md §3 — fieldValues generik menggantikan kolom baku (fullName,
  // gender, email, phone/whatsapp+countryCode, dst.) — bentuk & wajib-tidaknya field ditentukan
  // ManifestFieldRequirement produk yang relevan (divalidasi di superRefine di bawah), bukan
  // zod schema statis per field seperti sebelumnya.
  //
  // docs/arsitektur-booking.md §6 Step 6a — visaProductId JADI OPSIONAL (menggantikan keputusan
  // Step 5 yang mewajibkannya). Perubahan ini eksplisit diminta user: "tidak ada satupun product
  // mewajibkan product lain ketika checkout .. semua berdasarkan product checkout sesuai dengan
  // standard onlineshop" — checkout Transport-only tidak boleh memaksa pilih Visa. Pilgrim TANPA
  // visaProductId divalidasi terhadap field manifest "core" (lib/manifest/constants.ts) di
  // superRefine di bawah — bukan dibiarkan tanpa field manifest sama sekali.
  pilgrims: z.array(z.object({
    fieldValues: z.record(z.string(), z.unknown()).default({}),
    visaProductId: z.string().uuid('Pilih jenis visa yang valid').optional(),
    // Jumlah hari dipilih jamaah untuk visa day-based (mis. varian Non-Hotel) — opsional,
    // hanya relevan kalau VisaProduct terkait punya durationFeeRules. Lihat docs/arsitektur-visa.md §9.
    selectedDurationDays: z.number().int().min(1).optional(),
  })).min(1, 'Minimal 1 jamaah'),

  // totalAmount DIHAPUS dari input (docs/arsitektur-booking.md §6 Step 5, menutup Gap #4 KRITIS
  // docs/arsitektur-umroh.md §7) — dihitung TOTAL server-side di bookings/route.ts dari
  // unitPrice tiap item yang baru direservasi + harga visa per pilgrim, tidak pernah lagi
  // dipercaya dari client sama sekali (sebelumnya field individual sudah dihitung ulang, cuma
  // angka agregat ini yang masih lolos dari client).
}).superRefine(async (data, ctx) => {
  // Kuantitas yang menentukan harga TIDAK boleh bebas dari klien: malam/hari harus sama dengan selisih tanggalnya (audit keamanan Fase 4, H1) —
  // tanpa ini `nights: 1` untuk 14 malam hanya dibayar satu malam, dan rentang muthowif terbalik melewati pemeriksaan kapasitas.
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
  data.items.forEach((item, i) => {
    if (item.itemType === 'hotel') {
      const nights = dayDiff(item.checkIn, item.checkOut)
      if (nights < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal check-out harus setelah check-in', path: ['items', i, 'checkOut'] })
      else if (item.nights !== nights) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jumlah malam tidak sesuai dengan tanggal check-in/check-out', path: ['items', i, 'nights'] })
    } else if (item.itemType === 'muthowif' || item.itemType === 'catering') {
      const days = dayDiff(item.startDate, item.endDate) + 1
      if (days < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal selesai tidak boleh sebelum tanggal mulai', path: ['items', i, 'endDate'] })
      else if (item.numDays !== days) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jumlah hari tidak sesuai dengan rentang tanggal', path: ['items', i, 'numDays'] })
    }
  })

  // docs/arsitektur-booking.md §6 Step 6a — visaProductId opsional per pilgrim. Query VisaProduct/
  // ManifestFieldRequirement HANYA untuk pilgrim yang benar-benar pilih visa; pilgrim tanpa visa
  // divalidasi terhadap field manifest "core" di bawah. PENTING: early-return lama
  // (`if (ids.length === 0) return`) DIHAPUS — kalau dibiarkan, booking 100% tanpa visa akan
  // skip SEMUA validasi di bawah termasuk field manifest core yang wajib, bug tersembunyi yang
  // baru relevan sekarang visa bisa benar-benar kosong.
  const idsWithVisa = [...new Set(data.pilgrims.filter(p => p.visaProductId).map(p => p.visaProductId!))]

  // Validasi visaProductId terhadap VisaProduct aktif di database — menutup Gap #3
  // docs/arsitektur-visa.md §7 (dulu z.enum hardcode, sekarang query DB asli).
  const found = idsWithVisa.length > 0
    ? await prisma.visaProduct.findMany({
        where: { id: { in: idsWithVisa }, isActive: true },
        select: { id: true, requiredComponents: true },
      })
    : []
  const foundById = new Map(found.map(f => [f.id, f]))

  data.pilgrims.forEach((p, i) => {
    if (!p.visaProductId) return // tidak pilih visa — tidak ada yang divalidasi di sini
    if (!foundById.has(p.visaProductId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Produk visa tidak ditemukan atau tidak aktif',
        path: ['pilgrims', i, 'visaProductId'],
      })
    }
  })

  // Validasi silang requiredComponents (docs/arsitektur-visa.md §9.1-9.2): kalau varian visa yang
  // dipilih mewajibkan hotel/transport, request tanpa komponen itu ditolak — bukan cuma
  // mengandalkan UI wizard (lihat rencana Step 1 di docs/arsitektur-visa.md §9.6). Otomatis aman
  // untuk pilgrim tanpa visa — requiredComponentsUnion cuma terisi dari `found`, yang cuma berasal
  // dari pilgrim yang benar-benar pilih visa (§6 Step 6a) — checkout Transport-only tidak pernah
  // dipaksa punya hotel/transport gara-gara pilgrim lain di booking yang sama.
  const requiredComponentsUnion = new Set<string>()
  for (const product of found.values()) {
    const components = Array.isArray(product.requiredComponents) ? product.requiredComponents as string[] : []
    components.forEach(c => requiredComponentsUnion.add(c))
  }
  const hasHotelItem     = data.items.some(i => i.itemType === 'hotel')
  const hasTransportItem = data.items.some(i => i.itemType === 'transport')
  if (requiredComponentsUnion.has('hotel') && !hasHotelItem) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Varian visa yang dipilih mewajibkan hotel — pilih hotel Makkah atau Madinah',
      path: ['items'],
    })
  }
  if (requiredComponentsUnion.has('transport') && !hasTransportItem) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Varian visa yang dipilih mewajibkan transport — pilih minimal satu transport',
      path: ['items'],
    })
  }

  // docs/arsitektur-manifest.md §3 — field wajib ditentukan ManifestFieldRequirement produk yang
  // relevan (visa per pilgrim YANG PILIH visa; "core" — lib/manifest/constants.ts — untuk pilgrim
  // yang tidak), bukan hardcode zod per fieldKey — validasi tetap server-side.
  const requirementsByProduct = new Map<string, { fieldKey: string; label: string; required: boolean }[]>()
  for (const id of idsWithVisa) {
    requirementsByProduct.set(id, await prisma.manifestFieldRequirement.findMany({
      where: { productType: 'visa', productId: id },
      select: { fieldKey: true, label: true, required: true },
    }))
  }
  const needsCoreFields = data.pilgrims.some(p => !p.visaProductId)
  const coreFields = needsCoreFields
    ? await prisma.manifestFieldRequirement.findMany({
        where: { productType: CORE_MANIFEST_PRODUCT_TYPE, productId: CORE_MANIFEST_PRODUCT_ID },
        select: { fieldKey: true, label: true, required: true },
      })
    : []

  data.pilgrims.forEach((p, i) => {
    const requirements = p.visaProductId ? (requirementsByProduct.get(p.visaProductId) ?? []) : coreFields
    for (const req of requirements) {
      if (!req.required) continue
      const value = p.fieldValues[req.fieldKey]
      const isEmpty = value === undefined || value === null || value === ''
        || (typeof value === 'object' && value !== null && 'number' in value && !(value as { number?: string }).number)
      if (isEmpty) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${req.label} wajib diisi`,
          path: ['pilgrims', i, 'fieldValues', req.fieldKey],
        })
      }
    }
  })
})

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type BookingItemInput = z.infer<typeof bookingItemSchema>
