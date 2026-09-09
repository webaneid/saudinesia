import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { COUNTRIES } from '@/lib/constants/countries'
import type { AddressInput } from '@/lib/validators/address'

type PrepareResult =
  | { ok: true; data: Prisma.AddressUncheckedCreateInput }
  | { ok: false; message: string }

// Validasi hierarki (kecamatan benar-benar anak dari kab/kota yang dipilih, dst.) dan kode
// negara — server-side, tidak percaya urutan klik di UI. docs/arsitektur-alamat.md §3.2/§5.
export async function prepareAddressData(input: AddressInput): Promise<PrepareResult> {
  if (input.type === 'domestic') {
    const { provinceId, regencyId, districtId, villageId } = input
    if (regencyId) {
      const regency = await prisma.addressRegency.findUnique({ where: { id: regencyId } })
      if (!regency || regency.provinceId !== provinceId) return { ok: false, message: 'Kab/Kota tidak sesuai dengan Provinsi yang dipilih' }
    }
    if (districtId) {
      if (!regencyId) return { ok: false, message: 'Kab/Kota wajib dipilih sebelum Kecamatan' }
      const district = await prisma.addressDistrict.findUnique({ where: { id: districtId } })
      if (!district || district.regencyId !== regencyId) return { ok: false, message: 'Kecamatan tidak sesuai dengan Kab/Kota yang dipilih' }
    }
    if (villageId) {
      if (!districtId) return { ok: false, message: 'Kecamatan wajib dipilih sebelum Desa/Kelurahan' }
      const village = await prisma.addressVillage.findUnique({ where: { id: villageId } })
      if (!village || village.districtId !== districtId) return { ok: false, message: 'Desa/Kelurahan tidak sesuai dengan Kecamatan yang dipilih' }
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
    return { ok: false, message: 'Kode negara tidak dikenali' }
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

type UpsertResult = { ok: true; id: string } | { ok: false; message: string }

// Dipakai entity yang punya addressId sendiri (User/Vendor/Hotel, docs/arsitektur-alamat.md §9) —
// create/update Address DALAM request yang sama dengan entity pemiliknya (bukan API /api/v1/address
// terpisah), supaya atomik: kalau langkah entity gagal, tidak ada Address yatim tersisa.
export async function upsertAddress(existingAddressId: string | null, input: AddressInput): Promise<UpsertResult> {
  const prepared = await prepareAddressData(input)
  if (!prepared.ok) return { ok: false, message: prepared.message }

  if (existingAddressId) {
    const updated = await prisma.address.update({ where: { id: existingAddressId }, data: prepared.data })
    return { ok: true, id: updated.id }
  }
  const created = await prisma.address.create({ data: prepared.data })
  return { ok: true, id: created.id }
}
