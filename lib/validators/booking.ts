import { z } from 'zod'
import { prisma } from '@/lib/db'
import { CORE_MANIFEST_PRODUCT_TYPE, CORE_MANIFEST_PRODUCT_ID } from '@/lib/manifest/constants'
import { addDays, daysBetween, todayInApp } from '@/lib/time'
import { MAX_PRICE_IDR } from '@/lib/pricing/engine/manual'
import { isEmptyValue } from '@/lib/manifest/values'

// docs/arsitektur-booking.md §6 Step 5 — items[] generik menggantikan field tetap
// (hotelMakkah/hotelMadinah/transports/muthowif/catering/tourPackages). Satu keranjang campur
// bebas: kombinasi item apa pun, jumlah bebas per tipe (bukan cuma "maks 1 hotel Makkah"). Harga
// TIDAK PERNAH diterima dari client di sini — semua dihitung ulang server-side di
// app/api/v1/bookings/route.ts dari referensi (id jadwal/kuota) yang dikirim, pola yang sama
// persis dengan skema lama, cuma disatukan jadi satu discriminated union. Visa TETAP field
// terpisah (bukan itemType) — lihat §3.3: visa selalu per-jamaah, bukan per-booking.
/** Rombongan sasaran item/jamaah (docs/arsitektur-booking-engine-v2.md §10.8): indeks ke `groups`; kosong = semua jamaah. Batas = batas jamaah (setiap rombongan ≥ 1 orang). */
const groupIndex = z.number().int().min(0).max(1999).optional()

const bookingItemSchema = z.discriminatedUnion('itemType', [
  z.object({
    itemType: z.literal('hotel'),
    group: groupIndex,
    hotelRoomScheduleId: z.string().uuid(),
    checkIn:             z.string().date(),
    checkOut:            z.string().date(),
    nights:               z.number().int().min(1),
    numRooms:             z.number().int().min(1),
  }),
  z.object({
    itemType: z.literal('transport'),
    group: groupIndex,
    transportQuotaId: z.string().uuid(),
    numPassengers:    z.number().int().min(1),
    pickupDetail:     z.string().max(300).optional(),
    dropoffDetail:    z.string().max(300).optional(),
  }),
  z.object({
    itemType: z.literal('muthowif'),
    group: groupIndex,
    startDate: z.string().date(),
    endDate:   z.string().date(),
    numDays:   z.number().int().min(1),
    numPeople: z.number().int().min(1),
  }),
  z.object({
    itemType: z.literal('catering'),
    group: groupIndex,
    cateringOptionId: z.string().uuid(),
    startDate:        z.string().date(),
    endDate:          z.string().date(),
    numDays:          z.number().int().min(1),
    numPeople:        z.number().int().min(1),
    // `totalPrice` SENGAJA tidak ada: harga katering dihitung server dari CateringOption (lib/pricing/computeCateringPrice.ts).
  }),
  z.object({
    itemType: z.literal('tourPackage'),
    group: groupIndex,
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
    group: groupIndex,
    hajiProductId: z.string().uuid(),
    numPersons:    z.number().int().min(1),
  }),
  // Tiket pesawat (docs/arsitektur-booking-engine-v2.md §10.2): tanggal = tanggal terbang sungguhan, harus di periode jadwal (diperiksa server). Pergi-pulang = dua item.
  z.object({
    itemType: z.literal('flight'),
    group: groupIndex,
    flightScheduleId: z.string().uuid(),
    departureDate:    z.string().date(),
    numPassengers:    z.number().int().min(1).max(2000),
  }),
  // Paket Umroh (§10.2): harga PER ORANG × numPeople; `choices` = pilihan untuk komponen `user_choice` (di luar daftar opsi paket → 422).
  z.object({
    itemType: z.literal('package'),
    group: groupIndex,
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

  items: z.array(bookingItemSchema).max(50, 'Maksimal 50 item per booking').default([]),

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
    // memilih tier harga visa (rentang hari, `takeVisaTier`). Lihat docs/arsitektur-visa.md §3.
    selectedDurationDays: z.number().int().min(1).optional(),
  })).min(1, 'Minimal 1 jamaah').max(2000, 'Maksimal 2000 jamaah per booking'),

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
  // Dulu z.enum hardcode, sekarang query DB asli (riwayat audit visa 2026-07; as-built: docs/arsitektur-visa.md).
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
      // Satu aturan "kosong" dengan formulir/admin (lib/manifest/values.ts) — termasuk alamat tanpa baris jalan.
      if (isEmptyValue(p.fieldValues[req.fieldKey])) {
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
  group:                groupIndex,
  visaProductId:        z.string().uuid().optional(),
  selectedDurationDays: z.number().int().min(1).max(365).optional(),
}).strict()

/** Rombongan (§10.8, K11d-4): nama bebas pemesan (teks polos ≤ 60, tanpa karakter kontrol — sama dengan CHECK DB) + rencana berangkat visa bila tanpa tiket. */
export const bookingGroupSchema = z.object({
  label: z.string().trim().min(1).max(60, 'Nama rombongan maksimal 60 karakter').regex(/^[^\p{Cc}]*$/u, 'Nama rombongan tidak boleh memuat karakter kontrol').optional(),
  plannedTravelDate: z.string().date().optional(),
}).strict()
export type BookingGroupInput = z.infer<typeof bookingGroupSchema>

/**
 * Rombongan sah: tanpa `groups` → tak satu pun item/jamaah boleh menunjuk rombongan; dengan `groups` (≥ 2) → setiap jamaah menunjuk rombongan yang ada, setiap rombongan
 * ≥ 1 jamaah, item menunjuk rombongan yang ada atau kosong (= semua). Dipakai skema draf; mesin memeriksa ulang (`checkGroupShape`, lib/booking/groups.ts).
 */
function checkGroups(groups: readonly unknown[] | undefined, items: ReadonlyArray<{ group?: number }>, pilgrims: ReadonlyArray<{ group?: number }>, ctx: z.RefinementCtx): void {
  const n = groups?.length ?? 0
  if (n === 0) {
    items.forEach((it, i) => { if (it.group !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rombongan item tidak dikenal', path: ['items', i, 'group'] }) })
    pilgrims.forEach((p, i) => { if (p.group !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rombongan jamaah tidak dikenal', path: ['pilgrims', i, 'group'] }) })
    return
  }
  if (n < 2) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rombongan dipakai bila lebih dari satu — satu rombongan tidak perlu diisi', path: ['groups'] }); return }
  items.forEach((it, i) => { if (it.group !== undefined && it.group >= n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rombongan item tidak dikenal', path: ['items', i, 'group'] }) })
  pilgrims.forEach((p, i) => { if (p.group === undefined || p.group >= n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Setiap jamaah harus masuk satu rombongan', path: ['pilgrims', i, 'group'] }) })
  for (let g = 0; g < n; g++) if (!pilgrims.some(p => p.group === g)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Rombongan ke-${g + 1} belum punya jamaah`, path: ['groups', g] })
}

export const bookingDraftSchema = z.object({
  items:    z.array(bookingItemSchema).max(50).default([]),
  pilgrims: z.array(draftPilgrimSchema).min(1, 'Minimal 1 jamaah').max(2000),
  groups:   z.array(bookingGroupSchema).max(2000).optional(),
  /** Jatuh tempo (hari dari terbit) — bawaan Pengaturan Invoice, dapat diedit (D4). */
  dueDays:  z.number().int().min(0).max(365).optional(),
}).strict().superRefine((d, ctx) => {
  checkItemQuantities(d.items, ctx)
  checkGroups(d.groups, d.items, d.pilgrims, ctx)
  // Haji di luar form admin (§10.3 butir 8; "Visa Haji" belum ada — CLAUDE.md): draf menolaknya, bukan diam-diam.
  d.items.forEach((it, i) => { if (it.itemType === 'haji') ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Haji belum dapat dipesan lewat form booking admin', path: ['items', i] }) })
})

export type BookingDraft = z.infer<typeof bookingDraftSchema>

// Revisi booking terbit (docs/arsitektur-booking-engine-v2.md §10.4 6b): isi booking LENGKAP sesudah edit. Item lama membawa `ref` (baris yang sudah ada), item baru tanpa `ref`;
// jamaah lama membawa `pilgrimId`. Harga tetap dihitung server — `customSellIdr` hanya harga KHUSUS item (R4) — catatan wajib saat harga khusus DITETAPKAN/DIUBAH (diperiksa `lib/booking/revise.ts`, bukan di sini: harga khusus lama yang dikirim ulang tanpa perubahan tak perlu catatan baru); tak ada angka harga lain dari klien.
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
    // Revisi booking berrombongan menyusul di Fase 11d-2 (lib/booking/revise.ts menolak 409); rujukan rombongan di revisi ditolak di sini.
    if (it.item.group !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Rombongan belum dapat diubah lewat revisi', path: ['items', i, 'group'] })
    if (it.ref && it.ref.itemType !== it.item.itemType) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Jenis item tidak cocok dengan rujukannya', path: ['items', i, 'ref'] })
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
