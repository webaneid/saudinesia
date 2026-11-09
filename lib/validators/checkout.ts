import { z } from 'zod'
import type { BookingInput } from '@/lib/booking/create'
import type { BookingItemInput } from '@/lib/validators/booking'

// Checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5): SATU produk per pesanan, hanya pilihan + jumlah orang. Tanpa harga/total/tanggal booking/data
// jamaah — harga dihitung server (mesin pesan), tanggal booking diturunkan dari item (D1), data jamaah diisi SESUDAH terbit (D3). `.strict()` di setiap tingkat.

const uuid = z.string().uuid('Pilihan tidak valid')
const date = z.string().date('Tanggal tidak valid')
/** Batas jumlah orang lewat checkout. Rombongan lebih besar lewat admin (mesin menerima sampai 2000). */
export const CHECKOUT_MAX_PEOPLE = 100
const people = z.number().int().min(1, 'Minimal 1 orang').max(CHECKOUT_MAX_PEOPLE, `Maksimal ${CHECKOUT_MAX_PEOPLE} orang per pesanan`)

export const checkoutSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('package'),
    packageId: uuid,
    departureDate: date,
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
])

export type CheckoutInput = z.infer<typeof checkoutSchema>

/** Tanggal yang dipilih pelanggan (untuk penolakan tanggal lampau di route). */
export function checkoutDate(c: CheckoutInput): string | null {
  return c.kind === 'package' ? c.departureDate : c.kind === 'visa' ? c.plannedTravelDate : null
}

/**
 * Checkout → masukan mesin pesan. Jamaah = jumlah orang (tanpa data, D3). Visa = per jamaah. Paket memasangkan visanya sendiri ke jamaah (lineItems).
 * Haji TANPA visa umroh (keputusan H1 = b): jamaah Haji tidak pernah membawa `visaProductId`.
 */
export function checkoutInput(c: CheckoutInput): BookingInput {
  const blank = (n: number) => Array.from({ length: n }, () => ({ fieldValues: {} }))
  switch (c.kind) {
    case 'package': {
      const item: BookingItemInput = { itemType: 'package', packageId: c.packageId, departureDate: c.departureDate, numPeople: c.numPeople, choices: c.choices }
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
  }
}
