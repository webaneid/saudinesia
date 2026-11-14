import { z } from 'zod'
import { isCalendarDate } from '@/lib/time'

// Paket Umroh — keberangkatan dan isi halaman detail (K1, docs/arsitektur-paket-umroh.md §8). Satu-satunya bentuk masukan untuk
// lib/packages/departures.ts dan pembaruan durasi/rencana perjalanan paket. Semua `.strict()` (mass assignment: kursi ditahan/terjual
// dan harga tak pernah datang dari klien).

export const MAX_PACKAGE_DAYS = 60
export const MAX_DEPARTURE_SEATS = 1000

const calendarDate = z.string().refine(isCalendarDate, 'Tanggal tidak valid (YYYY-MM-DD)')
const plain = (max: number, label: string) => z.string().trim().min(1, `${label} wajib diisi`).max(max, `${label} maksimal ${max} karakter`)

export const departureCreateSchema = z.object({
  departureDate: calendarDate,
  totalSeats: z.number().int('Kursi harus bilangan bulat').min(1, 'Kursi minimal 1').max(MAX_DEPARTURE_SEATS, `Kursi maksimal ${MAX_DEPARTURE_SEATS}`),
  isActive: z.boolean().optional(),
  note: z.string().trim().max(500, 'Catatan maksimal 500 karakter').nullish(),
}).strict()
export type DepartureCreateInput = z.infer<typeof departureCreateSchema>

export const departureUpdateSchema = departureCreateSchema.partial().strict()
  .refine(v => Object.keys(v).length > 0, { error: 'Tidak ada perubahan' })
export type DepartureUpdateInput = z.infer<typeof departureUpdateSchema>

/** Rencana perjalanan per hari (K1-5): hari unik dan berurutan naik, teks polos. */
export const itinerarySchema = z.array(z.object({
  day: z.number().int().min(1, 'Hari minimal 1').max(MAX_PACKAGE_DAYS, `Hari maksimal ${MAX_PACKAGE_DAYS}`),
  title: plain(120, 'Judul hari'),
  body: z.string().trim().max(2000, 'Keterangan maksimal 2000 karakter'),
}).strict()).max(MAX_PACKAGE_DAYS, `Maksimal ${MAX_PACKAGE_DAYS} hari`)
  .refine(days => days.every((d, i) => i === 0 || d.day > days[i - 1]!.day), { error: 'Hari harus unik dan berurutan' })
export type Itinerary = z.infer<typeof itinerarySchema>

export const exclusionsSchema = z.array(plain(200, 'Butir')).max(30, 'Maksimal 30 butir')

/** Kolom detail paket — dipakai skema PUT paket admin (yang juga memeriksa rencana vs durasi TERSIMPAN) dan `packageDetailSchema`. */
export const packageDetailFields = {
  durationDays: z.number().int('Durasi harus bilangan bulat').min(1, 'Durasi minimal 1 hari').max(MAX_PACKAGE_DAYS, `Durasi maksimal ${MAX_PACKAGE_DAYS} hari`).nullish(),
  itinerary: itinerarySchema.optional(),
  exclusions: exclusionsSchema.optional(),
}

/** Isi detail paket yang diedit admin bersama durasi. Rencana perjalanan tak boleh melewati durasi (dicek bila keduanya ada). */
export const packageDetailSchema = z.object(packageDetailFields).strict().refine(v => !v.durationDays || !v.itinerary || v.itinerary.every(d => d.day <= v.durationDays!), {
  error: 'Rencana perjalanan melebihi durasi paket', path: ['itinerary'],
})
export type PackageDetailInput = z.infer<typeof packageDetailSchema>

/** Baca kolom JSON tersimpan dengan aman (data lama/rusak → kosong, bukan 500). */
export const readItinerary = (v: unknown): Itinerary => { const r = itinerarySchema.safeParse(v); return r.success ? r.data : [] }
export const readExclusions = (v: unknown): string[] => { const r = exclusionsSchema.safeParse(v); return r.success ? r.data : [] }
