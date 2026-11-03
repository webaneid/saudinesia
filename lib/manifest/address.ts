import { prisma } from '@/lib/db'
import { prepareAddressData, type WilayahDb } from '@/lib/address/prepare'
import { formatAddressLine } from '@/lib/address/format'
import { isEmptyAddress, manifestAddressInputSchema, type ManifestAddressValue } from './addressValue'

// Field manifest `fieldType='address'` (docs/arsitektur-jamaah.md §5.5 butir 3, D1): satu-satunya tempat nilai alamat jamaah booking dibekukan.
// Bentuk diperiksa ulang, hierarki wilayah lewat `prepareAddressData` (aturan yang sama dengan profil/kartu), dan `text` diturunkan dari nama
// wilayah di DB — nilai `text` dari klien selalu dibuang. Dipanggil route data jamaah admin dan pembuatan jamaah baru (lib/booking/lineItems.ts).

type FieldLite = { fieldKey: string; label: string; fieldType: string }
export type ResolvedAddresses = { ok: true; values: Record<string, unknown> } | { ok: false; errors: Record<string, string> }

export async function resolveAddressValues(fields: readonly FieldLite[], values: Record<string, unknown>, db: WilayahDb = prisma): Promise<ResolvedAddresses> {
  const out = { ...values }
  const errors: Record<string, string> = {}
  for (const f of fields) {
    if (f.fieldType !== 'address' || !(f.fieldKey in values)) continue
    const raw = values[f.fieldKey]
    if (raw === null || raw === undefined || raw === '' || isEmptyAddress(raw)) { out[f.fieldKey] = null; continue }
    const parsed = manifestAddressInputSchema.safeParse(raw)
    if (!parsed.success) { errors[f.fieldKey] = `${f.label}: ${parsed.error.issues[0]?.message ?? 'alamat tidak valid'}`; continue }
    const prepared = await prepareAddressData(parsed.data, db)
    if (!prepared.ok) { errors[f.fieldKey] = `${f.label}: ${prepared.message}`; continue }
    const d = prepared.data
    const value: ManifestAddressValue = {
      type: d.type === 'international' ? 'international' : 'domestic', fullAddress: d.fullAddress, postalCode: d.postalCode ?? null,
      provinceId: d.provinceId ?? null, regencyId: d.regencyId ?? null, districtId: d.districtId ?? null, villageId: d.villageId ?? null,
      countryCode: d.countryCode ?? null, city: d.city ?? null, stateRegion: d.stateRegion ?? null,
    }
    out[f.fieldKey] = { ...value, text: formatAddressLine({ ...value, ...(await wilayahNames(db, value)) }) }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, values: out }
}

async function wilayahNames(db: WilayahDb, a: ManifestAddressValue) {
  const pick = { select: { name: true } } as const
  const [province, regency, district, village] = await Promise.all([
    a.provinceId ? db.addressProvince.findUnique({ where: { id: a.provinceId }, ...pick }) : null,
    a.regencyId ? db.addressRegency.findUnique({ where: { id: a.regencyId }, ...pick }) : null,
    a.districtId ? db.addressDistrict.findUnique({ where: { id: a.districtId }, ...pick }) : null,
    a.villageId ? db.addressVillage.findUnique({ where: { id: a.villageId }, ...pick }) : null,
  ])
  return { province, regency, district, village }
}
