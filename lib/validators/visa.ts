import { z } from 'zod'

// Produk yang WAJIB dibeli bersama visa ini, di booking yang sama (docs/rencana-visa-produk.md §2.1; penilai: lib/booking/rules.ts). Daftar centang di editor
// produk visa; kosong = visa stand alone. Hotel dibedakan per kota (`Hotel.city`). Transport boleh dipersempit ke kategori jurusan (`TransportTrip.category`,
// mis. `airport`) atau trip tertentu; tanpa filter = transport apa pun.
export const REQUIRED_COMPONENT_TYPES = ['flight', 'hotel_makkah', 'hotel_madinah', 'transport', 'muthowif', 'tour', 'catering'] as const
export type RequiredComponentType = (typeof REQUIRED_COMPONENT_TYPES)[number]

/** Label tiap jenis (editor, lencana, pesan pelanggaran) — satu tempat. */
export const REQUIRED_COMPONENT_LABEL: Record<RequiredComponentType, string> = {
  flight: 'Tiket pesawat', hotel_makkah: 'Hotel Makkah', hotel_madinah: 'Hotel Madinah', transport: 'Transportasi', muthowif: 'Muthowif', tour: 'Wisata (Paket Ziarah)', catering: 'Katering',
}

export const requiredComponentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('flight') }).strict(),
  z.object({ type: z.literal('hotel_makkah') }).strict(),
  z.object({ type: z.literal('hotel_madinah') }).strict(),
  z.object({
    type: z.literal('transport'),
    categories: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    tripIds: z.array(z.string().uuid()).max(50).optional(),
  }).strict(),
  z.object({ type: z.literal('muthowif') }).strict(),
  z.object({ type: z.literal('tour') }).strict(),
  z.object({ type: z.literal('catering') }).strict(),
])

export const visaRequiredComponentsSchema = z.array(requiredComponentSchema).max(REQUIRED_COMPONENT_TYPES.length)
  .refine(list => new Set(list.map(c => c.type)).size === list.length, 'Setiap komponen hanya boleh disebut sekali')

export type RequiredComponent = z.infer<typeof requiredComponentSchema>

/** Baca kolom JSON `VisaProduct.requiredComponents`. Data tak sah dibaca sebagai "tanpa aturan" + `invalid: true` supaya pemanggil bisa menolak, bukan diam-diam meloloskan. */
export function parseRequiredComponents(json: unknown): { components: RequiredComponent[]; invalid: boolean } {
  const parsed = visaRequiredComponentsSchema.safeParse(json)
  return parsed.success ? { components: parsed.data, invalid: false } : { components: [], invalid: true }
}

// Model penjualan visa (docs/rencana-visa-produk.md §2.1) — TURUNAN dari `requiredComponents`, bukan kolom sendiri:
// kosong = "Visa only" (cukup lengkapi dokumen), berisi = "Visa plus" (komponen itu wajib dibeli dari kita di booking yang sama).
// `label` ringkas untuk lencana; `parts` = label tiap komponen (urut daftar centang) untuk ringkasan lengkap — keduanya bahasa admin.
// `types` = jenis komponen (urutan sama) untuk halaman pelanggan, yang menerjemahkannya lewat `checkout.components.<jenis>`.
export function visaSalesModel(components: readonly RequiredComponent[]): { plus: boolean; label: string; parts: string[]; types: RequiredComponentType[] } {
  const types = REQUIRED_COMPONENT_TYPES.filter(t => components.some(c => c.type === t))
  const parts = types.map(t => REQUIRED_COMPONENT_LABEL[t])
  return parts.length === 0 ? { plus: false, label: 'Visa only', parts, types } : { plus: true, label: `Visa plus · ${parts.length} komponen`, parts, types }
}
