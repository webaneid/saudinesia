import { z } from 'zod'
import type { BookingInput } from '@/lib/booking/create'
import type { BookingItemInput } from '@/lib/validators/booking'
import { daysBetween } from '@/lib/time'

// Checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5): SATU produk per pesanan, hanya pilihan + jumlah orang. Tanpa harga/total/tanggal booking/data
// jamaah — harga dihitung server (mesin pesan), tanggal booking diturunkan dari item (D1), data jamaah diisi SESUDAH terbit (D3). `.strict()` di setiap tingkat.

const uuid = z.string().uuid('Pilihan tidak valid')
const date = z.string().date('Tanggal tidak valid')
/** Batas lama menginap hotel lewat checkout (malam). Lebih panjang = beberapa pesanan/admin. */
export const CHECKOUT_MAX_NIGHTS = 60
/** Batas jumlah kamar per pesanan hotel lewat checkout. */
export const CHECKOUT_MAX_ROOMS = 50
/** Batas lama layanan muthowif / katering lewat checkout (hari, termasuk hari mulai dan selesai). */
export const CHECKOUT_MAX_DAYS = 60

/** Batas jumlah orang lewat checkout. Rombongan lebih besar lewat admin (mesin menerima sampai 2000). */
export const CHECKOUT_MAX_PEOPLE = 100
const people = z.number().int().min(1, 'Minimal 1 orang').max(CHECKOUT_MAX_PEOPLE, `Maksimal ${CHECKOUT_MAX_PEOPLE} orang per pesanan`)

export const checkoutSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('package'),
    packageId: uuid,
    departureId: uuid,
    numPeople: people,
    // Hanya komponen `user_choice` paket; di luar daftar opsi → 422 dari mesin (lib/booking/packageItem.ts).
    choices: z.object({
      hotelMakkahScheduleId: uuid.optional(),
      hotelMadinahScheduleId: uuid.optional(),
      transportPricingId: uuid.optional(),
      visaProductId: uuid.optional(),
      flightScheduleId: uuid.optional(),
      cateringOptionId: uuid.optional(),
    }).strict().default({}),
  }).strict(),
  z.object({
    kind: z.literal('visa'),
    visaProductId: uuid,
    numPeople: people,
    /** Jumlah hari (varian visa ber-rentang hari, `takeVisaTier`). */
    selectedDurationDays: z.number().int().min(1).max(365).optional(),
    plannedTravelDate: date,
  }).strict(),
  z.object({
    kind: z.literal('transport'),
    transportQuotaId: uuid,
    numPassengers: people,
    pickupDetail: z.string().trim().max(300).optional(),
    dropoffDetail: z.string().trim().max(300).optional(),
  }).strict(),
  z.object({
    kind: z.literal('haji'),
    hajiProductId: uuid,
    numPeople: people,
  }).strict(),
  // Hotel (§10.6): jadwal kamar dipilih halaman dari tanggal (lib/booking/hotelPick.ts); jumlah malam DIHITUNG server dari tanggal (tak pernah dari klien).
  // Kamar vs tamu tidak dipaksakan (K11b-2 = a, hanya diingatkan di halaman).
  z.object({
    kind: z.literal('hotel'),
    hotelRoomScheduleId: uuid,
    checkIn: date,
    checkOut: date,
    numRooms: z.number().int().min(1, 'Minimal 1 kamar').max(CHECKOUT_MAX_ROOMS, `Maksimal ${CHECKOUT_MAX_ROOMS} kamar per pesanan`),
    numGuests: people,
  }).strict(),
  // Paket Ziarah (§10.6): tanggal tur; kendaraan/hotel HANYA bila paketnya memberi pilihan (`user_choice`, divalidasi mesin terhadap opsi paket).
  z.object({
    kind: z.literal('tour'),
    tourPackageId: uuid,
    tourDate: date,
    numPeople: people,
    transportQuotaId: uuid.optional(),
    chosenHotelRoomScheduleId: uuid.optional(),
    chosenHotelNumRooms: z.number().int().min(1).max(CHECKOUT_MAX_ROOMS).optional(),
  }).strict(),
  // Muthowif (§10.6, K11b-3): SATU layanan umum — tanpa memilih orang (petugas ditentukan admin). Jumlah hari DIHITUNG server dari tanggal.
  z.object({
    kind: z.literal('muthowif'),
    startDate: date,
    endDate: date,
    numPeople: people,
  }).strict(),
  // Katering (§10.6): harga per orang per hari menurut musim TANGGAL MULAI (mesin); jumlah hari dihitung server.
  z.object({
    kind: z.literal('catering'),
    cateringOptionId: uuid,
    startDate: date,
    endDate: date,
    numPeople: people,
  }).strict(),
  // Tiket pesawat (§10.6, K11b-1 = b): satu arah + jadwal pulang OPSIONAL (dua item tiket dalam satu booking). Jadwal pulang harus rute kebalikan
  // (diperiksa server, lib/checkout/dates.ts); tanggal di luar periode jadwal → 422 dari mesin.
  z.object({
    kind: z.literal('flight'),
    flightScheduleId: uuid,
    departureDate: date,
    numPassengers: people,
    returnScheduleId: uuid.optional(),
    returnDate: date.optional(),
  }).strict(),
]).superRefine((c, ctx) => {
  if (c.kind === 'hotel') {
    const nights = daysBetween(c.checkIn, c.checkOut)
    if (nights < 1) ctx.addIssue({ code: 'custom', message: 'Tanggal check-out harus setelah check-in', path: ['checkOut'] })
    else if (nights > CHECKOUT_MAX_NIGHTS) ctx.addIssue({ code: 'custom', message: `Maksimal ${CHECKOUT_MAX_NIGHTS} malam per pesanan`, path: ['checkOut'] })
  }
  if (c.kind === 'muthowif' || c.kind === 'catering') {
    const days = daysBetween(c.startDate, c.endDate) + 1
    if (days < 1) ctx.addIssue({ code: 'custom', message: 'Tanggal selesai tidak boleh sebelum tanggal mulai', path: ['endDate'] })
    else if (days > CHECKOUT_MAX_DAYS) ctx.addIssue({ code: 'custom', message: `Maksimal ${CHECKOUT_MAX_DAYS} hari per pesanan`, path: ['endDate'] })
  }
  if (c.kind === 'flight') {
    if (!!c.returnScheduleId !== !!c.returnDate) ctx.addIssue({ code: 'custom', message: 'Pilih jadwal pulang beserta tanggalnya', path: ['returnDate'] })
    else if (c.returnDate && c.returnDate < c.departureDate) ctx.addIssue({ code: 'custom', message: 'Tanggal pulang tidak boleh sebelum tanggal berangkat', path: ['returnDate'] })
  }
  if (c.kind === 'tour' && !!c.chosenHotelRoomScheduleId !== !!c.chosenHotelNumRooms) {
    ctx.addIssue({ code: 'custom', message: 'Pilih hotel beserta jumlah kamarnya', path: ['chosenHotelNumRooms'] })
  }
})

export type CheckoutInput = z.infer<typeof checkoutSchema>

/** Tanggal yang dipilih pelanggan (untuk penolakan tanggal lampau di route). */
export function checkoutDate(c: CheckoutInput): string | null {
  switch (c.kind) {
    case 'package': return null // tanggal dari keberangkatan (server); keberangkatan lewat ditolak mesin
    case 'visa': return c.plannedTravelDate
    case 'hotel': return c.checkIn
    case 'tour': return c.tourDate
    case 'muthowif': return c.startDate
    case 'catering': return c.startDate
    case 'flight': return c.departureDate
    default: return null
  }
}

/**
 * Checkout → masukan mesin pesan. Jamaah = jumlah orang (tanpa data, D3). Visa = per jamaah. Paket memasangkan visanya sendiri ke jamaah (lineItems).
 * Haji TANPA visa umroh (keputusan H1 = b): jamaah Haji tidak pernah membawa `visaProductId`.
 */
export function checkoutInput(c: CheckoutInput): BookingInput {
  const blank = (n: number) => Array.from({ length: n }, () => ({ fieldValues: {} }))
  switch (c.kind) {
    case 'package': {
      const item: BookingItemInput = { itemType: 'package', packageId: c.packageId, departureId: c.departureId, numPeople: c.numPeople, choices: c.choices }
      return { items: [item], pilgrims: blank(c.numPeople), totalPilgrims: c.numPeople }
    }
    case 'visa':
      return {
        items: [],
        pilgrims: Array.from({ length: c.numPeople }, () => ({ fieldValues: {}, visaProductId: c.visaProductId, selectedDurationDays: c.selectedDurationDays })),
        totalPilgrims: c.numPeople,
        plannedTravelDate: c.plannedTravelDate,
      }
    case 'transport': {
      const item: BookingItemInput = { itemType: 'transport', transportQuotaId: c.transportQuotaId, numPassengers: c.numPassengers, pickupDetail: c.pickupDetail || undefined, dropoffDetail: c.dropoffDetail || undefined }
      return { items: [item], pilgrims: blank(c.numPassengers), totalPilgrims: c.numPassengers }
    }
    case 'haji': {
      const item: BookingItemInput = { itemType: 'haji', hajiProductId: c.hajiProductId, numPersons: c.numPeople }
      return { items: [item], pilgrims: blank(c.numPeople), totalPilgrims: c.numPeople }
    }
    case 'hotel': {
      const item: BookingItemInput = { itemType: 'hotel', hotelRoomScheduleId: c.hotelRoomScheduleId, checkIn: c.checkIn, checkOut: c.checkOut, nights: daysBetween(c.checkIn, c.checkOut), numRooms: c.numRooms }
      return { items: [item], pilgrims: blank(c.numGuests), totalPilgrims: c.numGuests }
    }
    case 'tour': {
      const item: BookingItemInput = {
        itemType: 'tourPackage', tourPackageId: c.tourPackageId, tourDate: c.tourDate, numPeople: c.numPeople,
        ...(c.transportQuotaId ? { transportQuotaId: c.transportQuotaId } : {}),
        ...(c.chosenHotelRoomScheduleId && c.chosenHotelNumRooms ? { chosenHotelRoomScheduleId: c.chosenHotelRoomScheduleId, chosenHotelNumRooms: c.chosenHotelNumRooms } : {}),
      }
      return { items: [item], pilgrims: blank(c.numPeople), totalPilgrims: c.numPeople }
    }
    case 'muthowif': {
      const item: BookingItemInput = { itemType: 'muthowif', startDate: c.startDate, endDate: c.endDate, numDays: daysBetween(c.startDate, c.endDate) + 1, numPeople: c.numPeople }
      return { items: [item], pilgrims: blank(c.numPeople), totalPilgrims: c.numPeople }
    }
    case 'catering': {
      const item: BookingItemInput = { itemType: 'catering', cateringOptionId: c.cateringOptionId, startDate: c.startDate, endDate: c.endDate, numDays: daysBetween(c.startDate, c.endDate) + 1, numPeople: c.numPeople }
      return { items: [item], pilgrims: blank(c.numPeople), totalPilgrims: c.numPeople }
    }
    case 'flight': {
      const items: BookingItemInput[] = [{ itemType: 'flight', flightScheduleId: c.flightScheduleId, departureDate: c.departureDate, numPassengers: c.numPassengers }]
      if (c.returnScheduleId && c.returnDate) items.push({ itemType: 'flight', flightScheduleId: c.returnScheduleId, departureDate: c.returnDate, numPassengers: c.numPassengers })
      return { items, pilgrims: blank(c.numPassengers), totalPilgrims: c.numPassengers }
    }
  }
}

// ── Keranjang (docs/arsitektur-booking-engine-v2.md §10.7, Fase 11c) ───────────────────────────────────────────────────────────────────────────
// SATU bentuk pesanan pelanggan: checkout satu produk = keranjang berisi satu entri. Satu rombongan (K11c-2): setiap entri berorang memakai jumlah
// jamaah yang SAMA (rombongan ganda = Fase 11d). Haji selalu sendirian (K11c-3). Paling banyak satu entri visa (satu orang satu visa).

/** Batas jumlah entri per keranjang. */
export const CART_MAX_ITEMS = 20

/** Jumlah orang satu entri (tamu untuk hotel, penumpang untuk transport/tiket). */
export function entryPeople(c: CheckoutInput): number {
  switch (c.kind) {
    case 'transport': case 'flight': return c.numPassengers
    case 'hotel': return c.numGuests
    default: return c.numPeople
  }
}

/** Entri dengan jumlah orang `n` (satu rombongan: halaman keranjang menyamakan semua entri). Jumlah kamar tidak ikut berubah. */
export function withPeople(c: CheckoutInput, n: number): CheckoutInput {
  switch (c.kind) {
    case 'transport': case 'flight': return { ...c, numPassengers: n }
    case 'hotel': return { ...c, numGuests: n }
    default: return { ...c, numPeople: n }
  }
}

export const checkoutCartSchema = z.object({
  items: z.array(checkoutSchema).min(1, 'Keranjang kosong').max(CART_MAX_ITEMS, `Maksimal ${CART_MAX_ITEMS} produk per pesanan`),
}).strict().superRefine((cart, ctx) => {
  if (cart.items.length > 1 && cart.items.some(c => c.kind === 'haji')) {
    ctx.addIssue({ code: 'custom', message: 'Haji dipesan tersendiri — tidak dapat digabung dengan produk lain', path: ['items'] })
  }
  if (cart.items.filter(c => c.kind === 'visa').length > 1) {
    ctx.addIssue({ code: 'custom', message: 'Satu pesanan hanya dapat memuat satu jenis visa', path: ['items'] })
  }
  const people = new Set(cart.items.map(entryPeople))
  if (people.size > 1) ctx.addIssue({ code: 'custom', message: 'Jumlah jamaah setiap produk di keranjang harus sama (satu rombongan)', path: ['items'] })
})

export type CheckoutCart = z.infer<typeof checkoutCartSchema>

/**
 * Keranjang → masukan mesin pesan: item setiap entri digabung, jamaah = N (sama untuk semua entri); visa (≤ 1 entri) melekat ke setiap jamaah.
 * Rencana berangkat visa = dari entri visa (mesin memakai tanggal tiket paling awal bila keranjang memuat tiket).
 */
export function cartInput(cart: CheckoutCart): BookingInput {
  const parts = cart.items.map(checkoutInput)
  if (parts.length === 1) return parts[0]!
  const n = Math.max(...cart.items.map(entryPeople))
  const visa = parts.find(p => p.pilgrims.some(x => x.visaProductId))
  return {
    items: parts.flatMap(p => p.items),
    pilgrims: visa ? visa.pilgrims.slice(0, n) : Array.from({ length: n }, () => ({ fieldValues: {} })),
    totalPilgrims: n,
    ...(visa?.plannedTravelDate ? { plannedTravelDate: visa.plannedTravelDate } : {}),
  }
}
