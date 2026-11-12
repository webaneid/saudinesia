import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { COUNTRIES } from '@/lib/constants/countries'
import type { AddressInput } from '@/lib/validators/address'
import { apiErrorText, type ApiErrorCode } from '@/lib/errors/api'
import { parseMapsUrl } from './maps'

/** Galat alamat: `message` = teks Indonesia (admin), `code` = kunci `apiErrors` (pelanggan, docs/arsitektur-i18n-frontend.md §6.6). */
export type AddressFailure = { ok: false; message: string; code: ApiErrorCode }
type PrepareResult = { ok: true; data: Prisma.AddressUncheckedCreateInput } | AddressFailure

const bad = (code: ApiErrorCode): AddressFailure => ({ ok: false, message: apiErrorText(code), code })

// Validasi hierarki (kecamatan benar-benar anak dari kab/kota yang dipilih, dst.) dan kode
// negara — server-side, tidak percaya urutan klik di UI. docs/arsitektur-alamat.md §3.2/§5.
/** Koneksi baca tabel wilayah — `prisma` atau klien transaksi (dipanggil di dalam transaksi booking: jangan mengambil koneksi pool kedua). */
export type WilayahDb = Pick<typeof prisma, 'addressProvince' | 'addressRegency' | 'addressDistrict' | 'addressVillage'>

export async function prepareAddressData(input: AddressInput, db: WilayahDb = prisma): Promise<PrepareResult> {
  const base = await prepareBase(input, db)
  if (!base.ok || input.mapsUrl === undefined) return base // tanpa kolom peta (profil/vendor/invoice) → lokasi lama tak disentuh
  if (input.mapsUrl === null) return { ok: true, data: { ...base.data, mapsUrl: null, latitude: null, longitude: null } }
  const m = parseMapsUrl(input.mapsUrl) // diperiksa ulang di server: koordinat SELALU diturunkan dari tautan, tak pernah dari klien
  if (!m.ok) return bad(m.code)
  return { ok: true, data: { ...base.data, mapsUrl: m.value.url, latitude: m.value.latitude, longitude: m.value.longitude } }
}

async function prepareBase(input: AddressInput, db: WilayahDb): Promise<PrepareResult> {
  if (input.type === 'domestic') {
    const { provinceId, regencyId, districtId, villageId } = input
    if (provinceId && !(await db.addressProvince.findUnique({ where: { id: provinceId }, select: { id: true } }))) return bad('provinceUnknown')
    if (regencyId) {
      const regency = await db.addressRegency.findUnique({ where: { id: regencyId } })
      if (!regency || regency.provinceId !== provinceId) return bad('regencyMismatch')
    }
    if (districtId) {
      if (!regencyId) return bad('regencyRequiredFirst')
      const district = await db.addressDistrict.findUnique({ where: { id: districtId } })
      if (!district || district.regencyId !== regencyId) return bad('districtMismatch')
    }
    if (villageId) {
      if (!districtId) return bad('districtRequiredFirst')
      const village = await db.addressVillage.findUnique({ where: { id: villageId } })
      if (!village || village.districtId !== districtId) return bad('villageMismatch')
    }

    return {
      ok: true,
      data: {
        type: 'domestic', fullAddress: input.fullAddress, postalCode: input.postalCode ?? null,
        provinceId: provinceId ?? null, regencyId: regencyId ?? null, districtId: districtId ?? null, villageId: villageId ?? null,
        countryCode: null, city: null, stateRegion: null,
      },
    }
  }

  // international
  if (!COUNTRIES.some(c => c.code === input.countryCode)) {
    return bad('countryCodeUnknown')
  }

  return {
    ok: true,
    data: {
      type: 'international', fullAddress: input.fullAddress, postalCode: input.postalCode ?? null,
      countryCode: input.countryCode, city: input.city ?? null, stateRegion: input.stateRegion ?? null,
      provinceId: null, regencyId: null, districtId: null, villageId: null,
    },
  }
}

type UpsertResult = { ok: true; id: string } | AddressFailure

// Dipakai entity yang punya addressId sendiri (User/Vendor/Hotel, docs/arsitektur-alamat.md §9) —
// create/update Address DALAM request yang sama dengan entity pemiliknya (bukan API /api/v1/address
// terpisah), supaya atomik: kalau langkah entity gagal, tidak ada Address yatim tersisa.
export async function upsertAddress(existingAddressId: string | null, input: AddressInput, db: Pick<typeof prisma, 'address'> & WilayahDb = prisma): Promise<UpsertResult> {
  const prepared = await prepareAddressData(input, db)
  if (!prepared.ok) return prepared

  if (existingAddressId) {
    const updated = await db.address.update({ where: { id: existingAddressId }, data: prepared.data })
    return { ok: true, id: updated.id }
  }
  const created = await db.address.create({ data: prepared.data })
  return { ok: true, id: created.id }
}
