import { z } from 'zod'
import { prisma } from '@/lib/db'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { addDays, daysBetween, todayInApp } from '@/lib/time'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'

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
    // Tanggal tur (D1: tanggal menempel di item). Bila kosong, jalur jamaah memakai `departureDate` booking (perilaku lama).
    tourDate:                  z.string().date().optional(),
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
  // Tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.2): tanggal = tanggal terbang sungguhan, harus di periode jadwal (diperiksa server). Pergi-pulang = dua item.
  z.object({
    itemType: z.literal('flight'),
    flightScheduleId: z.string().uuid(),
    departureDate:    z.string().date(),
    numPassengers:    z.number().int().min(1).max(2000),
  }),
  // Paket Umroh (§10.2): harga PER ORANG × numPeople; `choices` = pilihan untuk komponen `user_choice` (di luar daftar opsi paket → 422).
  z.object({
    itemType: z.literal('package'),
    packageId:     z.string().uuid(),
    departureDate: z.string().date(),
    numPeople:     z.number().int().min(1).max(2000),
    choices: z.object({
      hotelMakkahScheduleId:  z.string().uuid().optional(),
      hotelMadinahScheduleId: z.string().uuid().optional(),
      transportPricingId:     z.string().uuid().optional(),
      visaProductId:          z.string().uuid().optional(),
      flightScheduleId:       z.string().uuid().optional(),
      cateringOptionId:       z.string().uuid().optional(),
    }).strict().default({}),
  }),
])

export const createBookingSchema = z.object({
  departureDate:  z.string().date(),
  returnDate:     z.string().date(),
  season:         z.enum(['regular', 'ramadan', 'hajj']),
  bookingType:    z.enum(['individual', 'group']),
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
  checkItemQuantities(data.items, ctx)

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
        select: { id: true },
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

  // Aturan ketergantungan visa TIDAK di sini lagi: dievaluasi lib/booking/rules.ts dari route (422 + daftar pelanggaran, bisa
  // dilonggarkan per pelanggan, dan dipenuhi isi Paket) — docs/arsitektur-booking-engine-v2.md §10.2.

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


/**
 * Kuantitas yang menentukan harga TIDAK boleh bebas dari klien: malam/hari harus sama dengan selisih tanggalnya (audit keamanan Fase 4, H1) —
 * tanpa ini `nights: 1` untuk 14 malam hanya dibayar satu malam, dan rentang muthowif terbalik melewati pemeriksaan kapasitas. Dipakai jalur jamaah dan draf admin.
 */
function checkItemQuantities(items: readonly BookingItemInput[], ctx: z.RefinementCtx, base: (string | number)[] = ['items']): void {
  const dayDiff = daysBetween // tanggal kalender (`z.string().date()`): selisih hari tanpa pengaruh zona/DST
  items.forEach((item, i) => {
    if (item.itemType === 'hotel') {
      const nights = dayDiff(item.checkIn, item.checkOut)
      if (nights < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal check-out harus setelah check-in', path: [...base, i, 'checkOut'] })
      else if (item.nights !== nights) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jumlah malam tidak sesuai dengan tanggal check-in/check-out', path: [...base, i, 'nights'] })
    } else if (item.itemType === 'muthowif' || item.itemType === 'catering') {
      const days = dayDiff(item.startDate, item.endDate) + 1
      if (days < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal selesai tidak boleh sebelum tanggal mulai', path: [...base, i, 'endDate'] })
      else if (item.numDays !== days) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jumlah hari tidak sesuai dengan rentang tanggal', path: [...base, i, 'numDays'] })
    }
  })
}

export type CreateBookingInput = z.infer<typeof createBookingSchema>
export type BookingItemInput = z.infer<typeof bookingItemSchema>

// ── Draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3) ──────────────────────────────────────────────────────
// Isi draf = item + jamaah (jumlah dan visa per jamaah saja — data jamaah diisi SETELAH terbit, D3). Tanggal menempel di item (D1), jadi tak ada tanggal booking.
// `.strict()` di setiap tingkat: kolom liar (harga, total, status) ditolak — draf tak pernah membawa angka harga.
export const draftPilgrimSchema = z.object({
  visaProductId:        z.string().uuid().optional(),
  selectedDurationDays: z.number().int().min(1).max(365).optional(),
}).strict()

export const bookingDraftSchema = z.object({
  items:    z.array(bookingItemSchema).max(50).default([]),
  pilgrims: z.array(draftPilgrimSchema).min(1, 'Minimal 1 jamaah').max(2000),
  /** Jatuh tempo (hari dari terbit) — bawaan Pengaturan Invoice, dapat diedit (D4). */
  dueDays:  z.number().int().min(0).max(365).optional(),
}).strict().superRefine((d, ctx) => {
  checkItemQuantities(d.items, ctx)
  // Haji di luar form admin (§10.3 butir 8; "Visa Haji" belum ada — CLAUDE.md): draf menolaknya, bukan diam-diam.
  d.items.forEach((it, i) => { if (it.itemType === 'haji') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Haji belum dapat dipesan lewat form booking admin', path: ['items', i] }) })
})

export type BookingDraft = z.infer<typeof bookingDraftSchema>

// Revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b): isi booking LENGKAP sesudah edit. Item lama membawa `ref` (baris yang sudah ada), item baru tanpa `ref`;
// jamaah lama membawa `pilgrimId`. Harga tetap dihitung server — `customSellIdr` hanya harga KHUSUS item (R4) dengan catatan wajib; tak ada angka harga lain dari klien.
export const REVISABLE_ITEM_TYPES = ['hotel', 'transport', 'muthowif', 'catering', 'tourPackage', 'flight', 'package'] as const
const revisionItemSchema = z.object({
  ref: z.object({ itemType: z.enum(REVISABLE_ITEM_TYPES), itemId: z.string().uuid() }).strict().optional(),
  item: bookingItemSchema,
  customSellIdr: z.number().positive('Harga khusus harus lebih dari 0').max(MAX_PRICE_IDR, 'Harga khusus melebihi batas wajar').nullable().optional(),
  priceNote: z.string().trim().max(300).optional(),
}).strict()
export const bookingRevisionSchema = z.object({
  /** Revisi invoice yang dilihat editor — beda dengan yang tersimpan → 409 (tak menimpa revisi orang lain). */
  expectedRevision: z.number().int().min(1),
  items:    z.array(revisionItemSchema).max(50),
  pilgrims: z.array(z.object({
    pilgrimId: z.string().uuid().optional(),
    visaProductId: z.string().uuid().optional(),
    selectedDurationDays: z.number().int().min(1).max(365).optional(),
  }).strict()).min(1, 'Minimal 1 jamaah').max(2000),
  invoiceDate: z.string().date(),
  dueDate:     z.string().date(),
  reason:      z.string().trim().max(1000).optional(),
}).strict().superRefine((d, ctx) => {
  checkItemQuantities(d.items.map(i => i.item), ctx)
  d.items.forEach((it, i) => {
    if (it.item.itemType === 'haji') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Haji belum dapat diedit lewat form booking admin', path: ['items', i] })
    if (it.ref && it.ref.itemType !== it.item.itemType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jenis item tidak cocok dengan rujukannya', path: ['items', i, 'ref'] })
    if (it.customSellIdr != null && (it.priceNote?.length ?? 0) < 3) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Harga khusus wajib disertai catatan (minimal 3 karakter)', path: ['items', i, 'priceNote'] })
  })
  if (d.dueDate < d.invoiceDate) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jatuh tempo tidak boleh sebelum tanggal invoice', path: ['dueDate'] })
  // Rentang wajar (zona aplikasi): tanggal invoice ±1 tahun dari hari ini, jatuh tempo ≤ 365 hari sesudahnya (sejalan dengan `dueDays` 0–365 saat terbit).
  const today = todayInApp()
  if (d.invoiceDate < addDays(today, -366) || d.invoiceDate > addDays(today, 366)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Tanggal invoice di luar rentang wajar (±1 tahun dari hari ini)', path: ['invoiceDate'] })
  if (d.dueDate > addDays(d.invoiceDate, 365)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jatuh tempo paling lama 365 hari sesudah tanggal invoice', path: ['dueDate'] })
  const refs = d.items.flatMap(i => (i.ref ? [i.ref.itemId] : []))
  if (new Set(refs).size !== refs.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Item yang sama dikirim dua kali', path: ['items'] })
  const pids = d.pilgrims.flatMap(p => (p.pilgrimId ? [p.pilgrimId] : []))
  if (new Set(pids).size !== pids.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jamaah yang sama dikirim dua kali', path: ['pilgrims'] })
})
export type BookingRevisionInput = z.infer<typeof bookingRevisionSchema>
