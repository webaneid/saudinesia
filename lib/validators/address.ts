import { z } from 'zod'
import { MAPS_URL_MAX, parseMapsUrl } from '@/lib/address/maps'

// docs/arsitektur-alamat.md §3.1/§3.2 — type menentukan field mana yang relevan (domestik pakai
// provinceId..villageId, internasional pakai countryCode/city/stateRegion).
const addressFields = z.object({
  type:        z.enum(['domestic', 'international']),
  fullAddress: z.string().min(1, 'Alamat lengkap wajib diisi').max(500, 'Alamat terlalu panjang'),
  postalCode:  z.string().max(20, 'Kode pos terlalu panjang').nullish(),

  // AddressPicker (form terkontrol) selalu mengirim null untuk field yang belum dipilih,
  // bukan undefined — schema harus terima keduanya.
  provinceId: z.string().min(1).nullish(),
  regencyId:  z.string().min(1).nullish(),
  districtId: z.string().min(1).nullish(),
  villageId:  z.string().min(1).nullish(),

  countryCode: z.string().length(2).nullish(),
  city:        z.string().max(100, 'Nama kota terlalu panjang').nullish(),
  stateRegion: z.string().max(100, 'Nama provinsi/wilayah terlalu panjang').nullish(),
})

const refineAddress = (data: z.infer<typeof addressFields>, ctx: z.RefinementCtx) => {
  if (data.type === 'domestic' && !data.provinceId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provinsi wajib diisi untuk alamat domestik', path: ['provinceId'] })
  }
  if (data.type === 'international' && !data.countryCode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Negara wajib diisi untuk alamat luar negeri', path: ['countryCode'] })
  }
}

export const addressSchema = addressFields.superRefine(refineAddress)

// Alamat + lokasi Google Maps opsional (docs/arsitektur-hotel.md §12.5) — HANYA untuk pemilik yang lokasinya publik (hotel).
// Profil jamaah/vendor/Pengaturan Invoice tetap `addressSchema` (kolom ini dibuang diam-diam oleh z.object), jadi titik lokasi rumah tak pernah tersimpan.
export const mapsUrlField = z.string().trim().max(MAPS_URL_MAX, 'Tautan Google Maps terlalu panjang')
  .refine(v => v === '' || parseMapsUrl(v).ok, 'Tautan harus tautan Google Maps (https://maps.app.goo.gl/… atau https://www.google.com/maps/…)')
  .transform(v => v === '' ? null : v).nullish()
export const addressWithMapSchema = addressFields.extend({ mapsUrl: mapsUrlField }).superRefine(refineAddress)

export type AddressInput = z.infer<typeof addressSchema> & { mapsUrl?: string | null }
