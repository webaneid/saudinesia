import type { Prisma } from '@prisma/client'
import { formatAddressLine } from '@/lib/address/format'
import type { CardForSnapshot } from '@/lib/manifest/roles'
import type { ManifestAddressValue } from '@/lib/manifest/addressValue'
import { calendarDateOf } from '@/lib/time'

// Bentuk kartu yang dibekukan ke jamaah booking — dipakai tautan (bookingLink.ts) dan penyelarasan kartu → booking (bookingSync.ts). Baca saja.

export const cardSelect = {
  id: true, ownerId: true, identityId: true, archivedAt: true, fullName: true, gender: true, birthPlace: true, birthDate: true, nationality: true,
  nikHash: true, nikCipher: true, passportKeyHash: true, passportCipher: true, passportLast4: true, passportIssuedAt: true, passportExpiry: true,
  phone: true, whatsapp: true, email: true, extraValues: true,
  address: { select: { type: true, fullAddress: true, postalCode: true, city: true, stateRegion: true, countryCode: true,
    provinceId: true, regencyId: true, districtId: true, villageId: true,
    village: { select: { name: true } }, district: { select: { name: true } }, regency: { select: { name: true } }, province: { select: { name: true } } } },
} satisfies Prisma.SavedPilgrimSelect
export type CardRow = Prisma.SavedPilgrimGetPayload<{ select: typeof cardSelect }>

const cal = (d: Date | null) => (d ? calendarDateOf(d) : null)
export const forSnapshot = (c: CardRow): CardForSnapshot => ({
  fullName: c.fullName, gender: c.gender, birthPlace: c.birthPlace, birthDate: cal(c.birthDate), nationality: c.nationality,
  hasNik: c.nikHash !== null, passportLast4: c.passportLast4, passportIssuedAt: cal(c.passportIssuedAt), passportExpiry: cal(c.passportExpiry),
  phone: c.phone, whatsapp: c.whatsapp, email: c.email, address: addressOf(c.address),
  extra: c.extraValues && typeof c.extraValues === 'object' && !Array.isArray(c.extraValues) ? (c.extraValues as Record<string, unknown>) : {},
})
function addressOf(a: CardRow['address']): ManifestAddressValue | null {
  if (!a) return null
  return {
    type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode, provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId,
    villageId: a.villageId, countryCode: a.countryCode, city: a.city, stateRegion: a.stateRegion, text: formatAddressLine(a),
  }
}

/** Kolom tersegel jamaah booking = salinan kartu apa adanya (tanpa membuka). `keepEmpty`: kartu tak punya nomor itu → segel booking dibiarkan. */
export const sealedColumns = (c: CardRow, keepEmpty: { nik: boolean; passport: boolean }) => ({
  ...(c.nikHash === null && keepEmpty.nik ? {} : { nikHash: c.nikHash, nikCipher: c.nikCipher }),
  ...(c.passportCipher === null && keepEmpty.passport ? {} : {
    passportCountry: c.passportCipher ? c.nationality : null, passportKeyHash: c.passportKeyHash, passportCipher: c.passportCipher, passportLast4: c.passportLast4,
  }),
})
