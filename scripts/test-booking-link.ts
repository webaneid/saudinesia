// Uji tautan kartu jamaah tersimpan → jamaah booking (lib/pilgrims/bookingLink.ts, docs/arsitektur-jamaah.md §5.3, Fase 7a) terhadap DATABASE
// SUNGGUHAN + penyimpanan memori: snapshot lewat pengikat peran (kartu diedit kemudian TIDAK mengubah booking; "perbarui dari kartu" mengubahnya),
// NIK/paspor tersegel (tak pernah polos di booking_pilgrims, bisa dibuka dengan kunci baris), kartu akun lain / terarsip / kembar ditolak,
// dokumen per perjalanan (jenis reusable ditolak, lepas tautan diblokir selama ada), isian manual tersegel, kelengkapan, dan penjaga sumber.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { __resetForTests } from '@/lib/auth/rateLimit'
import { createSavedPilgrim, type Actor } from '@/lib/pilgrims/service'
import { bookingChecklists, linkCard, pilgrimBookingState, sealManualPii, sealNewPilgrim, tripScopeOf, unlinkCard } from '@/lib/pilgrims/bookingLink'
import { createDocumentService, listCardDocuments } from '@/lib/documents/service'
import type { DocumentStorage } from '@/lib/documents/storage'
import { writeRequirements } from '@/lib/documents/requirements'
import { MANIFEST_ROLES, snapshotFromCard } from '@/lib/manifest/roles'
import { resolveAddressValues } from '@/lib/manifest/address'
import { validateFieldValues } from '@/lib/manifest/values'
import { NIK_MASK, openNik, openPassport } from '@/lib/pii'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const env = process.env as Record<string, string | undefined>
env.PII_INDEX_KEY = randomBytes(32).toString('hex')
env.PII_ENCRYPTION_KEY = randomBytes(32).toString('hex')
env.PII_ENCRYPTION_KEY_VERSION = '1'
delete env.PII_ENCRYPTION_KEYS_RETIRED
delete env.REDIS_URL
__resetForTests()
await prisma.piiKeyCheck.deleteMany()

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tag = `bl${Date.now()}`
let n = 0
const users: string[] = []
const visas: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role, emailVerifiedAt: new Date() }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}
const serial = Number(String(Date.now()).slice(-3))
const NIK = `3201011507850${String(serial).padStart(3, '1')}`
const PASSPORT = `C${String(Date.now()).slice(-7)}`
async function makeCard(owner: Actor, by: Actor, over: Record<string, unknown> = {}): Promise<string> {
  const r = await createSavedPilgrim(by, owner.userId, savedPilgrimInputSchema.parse({ fullName: `Budi ${++n}`, gender: 'male', birthPlace: 'Bandung', birthDate: '2025-06-01', nationality: 'ID', phone: '6281234567890', ...over }))
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
  return r.card.id
}

const staff = await makeUser('admin')
const owner = await makeUser()
const other = await makeUser()

// Produk visa dengan field berperan + satu field bebas (tak boleh disentuh kartu).
const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh' } })
visas.push(visa.id)
const F = (fieldKey: string, fieldType: string, role: string | null, order: number) => ({ productType: 'visa', productId: visa.id, fieldKey, label: fieldKey, fieldType, role, order, required: role !== null })
await prisma.manifestFieldRequirement.createMany({ data: [
  F('fullName', 'text', 'display_name', 0), F('gender', 'select', 'gender', 1), F('dateOfBirth', 'date', 'birth_date', 2), F('nationality', 'text', 'nationality', 3),
  F('phone', 'phone', 'phone', 4), F('nik', 'text', 'nik', 5), F('passportNumber', 'text', 'passport_number', 6), F('mahram', 'text', null, 7),
] })
const types = Object.fromEntries((await prisma.documentType.findMany()).map(x => [x.key, x]))
await prisma.$transaction(tx => writeRequirements(tx, 'visa', visa.id, [
  { documentTypeId: types.passport!.id, label: null, description: '', required: true },
  { documentTypeId: types.flight_ticket!.id, label: null, description: '', required: true },
]))

async function makeBooking(o: Actor, pilgrims = 2, status: 'active' | 'draft' = 'active') {
  const b = await prisma.booking.create({
    data: {
      bookingCode: `BK-${tag}-${++n}`, userId: o.userId, status, season: 'regular', totalAmount: 1,
      pilgrims: { create: Array.from({ length: pilgrims }, (_, i) => ({ isLeader: i === 0, fieldValues: { mahram: 'Ayah', fullName: 'Ketik Manual' } })) },
    },
    include: { pilgrims: { orderBy: { id: 'asc' }, select: { id: true } } },
  })
  for (const p of b.pilgrims) await prisma.visaApplication.create({ data: { bookingPilgrimId: p.id, visaType: 'umrah', visaProductId: visa.id, plannedTravelDate: new Date('2026-12-01') } })
  return { id: b.id, pilgrims: b.pilgrims.map(p => p.id) }
}
const row = (id: string) => prisma.bookingPilgrim.findUniqueOrThrow({ where: { id } })

const mem = new Map<string, Buffer>()
const storage: DocumentStorage = {
  put: async (k, b) => { mem.set(k, b) },
  remove: async (k) => { mem.delete(k) },
  removePrefix: async (p) => { let c = 0; for (const k of [...mem.keys()]) if (k.startsWith(p)) { mem.delete(k); c++ } return c },
  url: async (k) => `https://minio.test/${k}?X-Amz-Signature=uji`,
}
const svc = createDocumentService(storage)
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')

const cardA = await makeCard(owner, staff, { birthDate: '1985-07-15', nik: NIK, passport: { number: PASSPORT, expiry: '2030-01-01' } })
const bk = await makeBooking(owner)
const [p1, p2] = bk.pilgrims as [string, string]

await t('TAUTKAN: hanya field berperan diisi dari kartu (field bebas tetap), NIK/paspor tersamar di snapshot, segel disalin apa adanya', async () => {
  const r = await linkCard(staff, bk.id, p1, cardA)
  assert.ok(r.ok, JSON.stringify(r))
  const bp = await row(p1)
  const fv = bp.fieldValues as Record<string, unknown>
  assert.equal(fv.mahram, 'Ayah', 'field tanpa peran tak disentuh')
  assert.match(String(fv.fullName), /^Budi /)
  assert.deepEqual([fv.gender, fv.dateOfBirth, fv.nationality], ['male', '1985-07-15', 'Indonesia'])
  assert.deepEqual(fv.phone, { countryCode: 'ID', number: '81234567890' })
  assert.equal(fv.nik, NIK_MASK)
  assert.equal(fv.passportNumber, `••••${PASSPORT.slice(-4)}`)
  const card = await prisma.savedPilgrim.findUniqueOrThrow({ where: { id: cardA } })
  assert.deepEqual([bp.savedPilgrimId, bp.identityId, bp.nikHash, bp.nikCipher, bp.passportKeyHash, bp.passportCipher, bp.passportLast4, bp.passportCountry],
    [cardA, card.identityId, card.nikHash, card.nikCipher, card.passportKeyHash, card.passportCipher, card.passportLast4, 'ID'])
  assert.equal(openNik(bp.nikCipher!, bp.nikHash!), NIK, 'segel dibuka dengan indeks baris booking')
  assert.equal(openPassport(bp.passportCipher!, { countryCode: bp.passportCountry!, keyHash: bp.passportKeyHash! }), PASSPORT)
  const raw = JSON.stringify(bp)
  assert.ok(!raw.includes(NIK) && !raw.includes(PASSPORT), 'NIK/paspor tak pernah polos di booking_pilgrims')
})

await t('SNAPSHOT BEKU: kartu diedit → booking tetap; "perbarui dari kartu" (tautkan ulang) → mengikuti kartu', async () => {
  await prisma.savedPilgrim.update({ where: { id: cardA }, data: { fullName: 'Budi Nama Baru', birthPlace: 'Garut' } }) // (uji) setara edit kartu
  assert.notEqual(((await row(p1)).fieldValues as Record<string, unknown>).fullName, 'Budi Nama Baru')
  assert.ok((await linkCard(staff, bk.id, p1, cardA)).ok)
  const fv = (await row(p1)).fieldValues as Record<string, unknown>
  assert.equal(fv.fullName, 'Budi Nama Baru'); assert.equal(fv.mahram, 'Ayah')
})

await t('DITOLAK: kartu akun lain → 404 (sama dengan tidak ada); kartu terarsip → 409; kartu sudah dipakai jamaah lain di booking sama → 409; draf → 404', async () => {
  const foreign = await makeCard(other, staff)
  const r1 = await linkCard(staff, bk.id, p2, foreign)
  assert.deepEqual(!r1.ok && [r1.status, r1.field], [404, 'cardId'])
  const ghost = await linkCard(staff, bk.id, p2, '00000000-0000-4000-8000-000000000000')
  assert.deepEqual(ghost, r1, 'respons identik: tidak membuka keberadaan kartu akun lain')
  const archived = await makeCard(owner, staff)
  await prisma.savedPilgrim.update({ where: { id: archived }, data: { archivedAt: new Date() } })
  const r2 = await linkCard(staff, bk.id, p2, archived)
  assert.equal(!r2.ok && r2.status, 409)
  const r3 = await linkCard(staff, bk.id, p2, cardA)
  assert.equal(!r3.ok && r3.status, 409, 'satu kartu = satu jamaah per booking')
  const draft = await makeBooking(owner, 1, 'draft')
  const r4 = await linkCard(staff, draft.id, draft.pilgrims[0]!, cardA)
  assert.equal(!r4.ok && r4.status, 404)
  const wrongBooking = await linkCard(staff, draft.id, p2, cardA)
  assert.equal(!wrongBooking.ok && wrongBooking.status, 404, 'jamaah harus milik booking di URL')
})

await t('PELAKU: jamaah lain (bukan pemilik booking) → 404; pemilik booking sendiri boleh (dipakai 7b)', async () => {
  const r = await linkCard(other, bk.id, p2, cardA)
  assert.equal(!r.ok && r.status, 404)
  const mine = await makeCard(owner, owner)
  assert.ok((await linkCard(owner, bk.id, p2, mine)).ok)
  assert.ok((await unlinkCard(owner, bk.id, p2)).ok)
})

await t('DOKUMEN PERJALANAN: jenis reusable (paspor) ditolak; tiket diterima menempel ke booking; tak terlihat di cakupan kartu; lepas tautan diblokir selama ada', async () => {
  const s = await tripScopeOf(bk.id, p1)
  assert.deepEqual(s, { ownerId: owner.userId, cardId: cardA })
  assert.equal(await tripScopeOf(bk.id, p2), null, 'belum tertaut → tak ada cakupan (404)')
  const scope = { bookingId: bk.id }
  const bad = await svc.upload(staff, owner.userId, cardA, { documentTypeId: types.passport!.id }, pdf, scope)
  assert.equal(!bad.ok && bad.status, 400, 'jenis milik orang tak boleh diunggah per perjalanan')
  const ok = await svc.upload(staff, owner.userId, cardA, { documentTypeId: types.flight_ticket!.id, referenceCode: 'ABC123' }, pdf, scope)
  assert.ok(ok.ok, JSON.stringify(ok))
  const doc = await prisma.pilgrimDocument.findUniqueOrThrow({ where: { id: ok.ok ? ok.document.id : '' } })
  assert.equal(doc.bookingId, bk.id)
  const trip = await listCardDocuments(staff, owner.userId, cardA, scope)
  const own = await listCardDocuments(staff, owner.userId, cardA)
  assert.deepEqual(trip?.map(d => d.id), [doc.id]); assert.ok(own && !own.some(d => d.id === doc.id), 'dokumen perjalanan tak tercampur dokumen kartu')
  const cardOnly = await svc.upload(staff, owner.userId, cardA, { documentTypeId: types.flight_ticket!.id, referenceCode: 'ABC123' }, pdf)
  assert.equal(!cardOnly.ok && cardOnly.status, 400, 'tiket (non-reusable) tak boleh disimpan di kartu')
  const blocked = await unlinkCard(staff, bk.id, p1)
  assert.equal(!blocked.ok && blocked.status, 409)
  // Cakupan perjalanan booking LAIN tak bisa menghapus/membuka dokumen ini.
  const other = await makeBooking(owner, 1)
  assert.equal((await svc.previewUrl(staff, owner.userId, cardA, doc.id, { bookingId: other.id })).ok, false)
  const rm = await svc.remove(staff, owner.userId, cardA, doc.id, scope)
  assert.ok(rm.ok)
  const un = await unlinkCard(staff, bk.id, p1)
  assert.ok(un.ok)
  const bp = await row(p1)
  assert.equal(bp.savedPilgrimId, null); assert.equal(bp.identityId, null)
  assert.equal((bp.fieldValues as Record<string, unknown>).fullName, 'Budi Nama Baru', 'snapshot tetap sesudah dilepas')
  assert.ok(bp.nikCipher, 'segel tetap (data booking)')
  assert.equal(!(await unlinkCard(staff, bk.id, p1)).ok, true, 'lepas dua kali → 409')
  assert.ok((await linkCard(staff, bk.id, p1, cardA)).ok, 'tautkan kembali')
})

await t('GANTI KARTU: kartu lama masih memegang dokumen perjalanan → 409 (sama dengan lepas); perbarui dari kartu yang sama tetap boleh', async () => {
  const doc = await svc.upload(staff, owner.userId, cardA, { documentTypeId: types.flight_ticket!.id, referenceCode: 'XYZ789' }, pdf, { bookingId: bk.id })
  assert.ok(doc.ok, JSON.stringify(doc))
  const cardB = await makeCard(owner, staff)
  const swap = await linkCard(staff, bk.id, p1, cardB)
  assert.equal(!swap.ok && swap.status, 409, 'dokumen perjalanan kartu lama akan tertinggal')
  assert.equal((await row(p1)).savedPilgrimId, cardA)
  assert.ok((await linkCard(staff, bk.id, p1, cardA)).ok, 'perbarui dari kartu yang sama')
  assert.ok((await svc.remove(staff, owner.userId, cardA, doc.ok ? doc.document.id : '', { bookingId: bk.id })).ok)
})

await t('JAMAAH BARU (checkout/booking admin): NIK/paspor disegel sebelum ditulis; negara paspor dari field kebangsaan ISO; galat bentuk dilaporkan', async () => {
  const r = await prisma.$transaction(tx => sealNewPilgrim(tx, visa.id, { fullName: 'Checkout', nationality: 'SA', nik: NIK, passportNumber: 'k 1234567' }))
  assert.ok(r.ok, JSON.stringify(r))
  if (!r.ok) return
  assert.equal(r.values.nik, NIK_MASK); assert.equal(r.values.passportNumber, '••••4567')
  assert.equal(r.columns.passportCountry, 'SA')
  assert.ok(!JSON.stringify(r.values).includes(NIK) && !JSON.stringify(r.values).includes('1234567'))
  const id = (await prisma.bookingPilgrim.create({ data: { bookingId: bk.id, fieldValues: r.values as Prisma.InputJsonValue, ...r.columns }, select: { id: true } })).id
  const saved = await row(id)
  assert.equal(openNik(saved.nikCipher!, saved.nikHash!), NIK)
  await prisma.bookingPilgrim.delete({ where: { id } })
  const plain = await prisma.$transaction(tx => sealNewPilgrim(tx, visa.id, { fullName: 'WNI', nationality: 'Indonesia', passportNumber: 'B7654321' }))
  assert.ok(plain.ok && plain.columns.passportCountry === 'ID', 'kebangsaan bukan kode ISO → ID')
  const bad = await prisma.$transaction(tx => sealNewPilgrim(tx, visa.id, { nik: '123' }))
  assert.ok(!bad.ok && 'nik' in bad.errors)
})

await t('JAMAAH MENAMBAH hanya pada booking aktif: batal/selesai → closed; booking akun lain / draf → missing (404 di route)', async () => {
  assert.equal(await pilgrimBookingState(bk.id, owner.userId), 'open')
  assert.equal(await pilgrimBookingState(bk.id, other.userId), 'missing')
  const done = await makeBooking(owner, 1)
  await prisma.booking.update({ where: { id: done.id }, data: { status: 'cancelled' } })
  assert.equal(await pilgrimBookingState(done.id, owner.userId), 'closed')
  const draft = await makeBooking(owner, 1, 'draft')
  assert.equal(await pilgrimBookingState(draft.id, owner.userId), 'missing')
})

await t('UNGGAH PERJALANAN pada jamaah yang bukan tautannya / booking draf → 404 (kunci baris jamaah booking)', async () => {
  const lone = await makeCard(owner, staff)
  const r = await svc.upload(staff, owner.userId, lone, { documentTypeId: types.flight_ticket!.id, referenceCode: 'ABC123' }, pdf, { bookingId: bk.id })
  assert.equal(!r.ok && r.status, 404, 'kartu tak tertaut ke booking ini')
  const foreign = await svc.upload(staff, other.userId, cardA, { documentTypeId: types.flight_ticket!.id, referenceCode: 'ABC123' }, pdf, { bookingId: bk.id })
  assert.equal(!foreign.ok && foreign.status, 404)
})

await t('ISIAN MANUAL: NIK/paspor disegel + diganti samaran; samaran = tetap; kosong = hapus segel; salah bentuk = galat per field', async () => {
  const fields = [{ fieldKey: 'nik', label: 'NIK', role: 'nik' }, { fieldKey: 'passportNumber', label: 'Paspor', role: 'passport_number' }, { fieldKey: 'mahram', label: 'Mahram', role: null }]
  const s = await sealManualPii(fields, { nik: '3201 0115 0785 0042', passportNumber: 'a1234567', mahram: 'x' }, 'ID')
  assert.ok(s.ok)
  if (!s.ok) return
  assert.deepEqual([s.values.nik, s.values.passportNumber, s.values.mahram], [NIK_MASK, '••••4567', 'x'])
  assert.equal(openNik(String(s.columns.nikCipher), String(s.columns.nikHash)), '3201011507850042')
  assert.equal(openPassport(String(s.columns.passportCipher), { countryCode: 'ID', keyHash: String(s.columns.passportKeyHash) }), 'A1234567')
  assert.ok(!JSON.stringify(s).includes('3201011507850042') && !JSON.stringify(s).includes('A1234567'))
  const keep = await sealManualPii(fields, { nik: NIK_MASK, passportNumber: '••••4567' }, 'ID')
  assert.ok(keep.ok && !('nik' in keep.values) && !('passportNumber' in keep.values) && Object.keys(keep.columns).length === 0, 'samaran = tidak diubah')
  const clear = await sealManualPii(fields, { nik: '', passportNumber: null }, 'ID')
  assert.ok(clear.ok)
  assert.deepEqual(clear.ok && clear.columns, { nikHash: null, nikCipher: null, passportCountry: null, passportKeyHash: null, passportCipher: null, passportLast4: null })
  const bad = await sealManualPii(fields, { nik: '0201011507850042', passportNumber: 'ab' }, 'ID')
  assert.deepEqual(!bad.ok && Object.keys(bad.errors).sort(), ['nik', 'passportNumber'])
  assert.ok(!bad.ok && !JSON.stringify(bad).includes('0201011507850042'), 'galat tak memuat nilai')
})

await t('KELENGKAPAN: syarat visa; tertaut → dokumen kartu + perjalanan dihitung; tak tertaut → semua missing', async () => {
  await svc.upload(staff, owner.userId, cardA, { documentTypeId: types.passport!.id, expiresAt: '2030-01-01' }, pdf)
  const m = await bookingChecklists(bk.id, null, [
    { id: p1, savedPilgrimId: cardA, visaProductId: visa.id, plannedTravelDate: '2026-12-01' },
    { id: p2, savedPilgrimId: null, visaProductId: visa.id, plannedTravelDate: '2026-12-01' },
  ])
  assert.deepEqual(m.get(p1)!.items.map(i => [i.key, i.state]), [['passport', 'pending'], ['flight_ticket', 'missing']])
  assert.equal(m.get(p1)!.card?.id, cardA)
  assert.deepEqual(m.get(p2)!.items.map(i => i.state), ['missing', 'missing']); assert.equal(m.get(p2)!.card, null)
})

await t('PERAN: snapshotFromCard murni — hanya field berperan; tanggal hanya ke field tanggal; kartu tanpa NIK mengosongkan field NIK', () => {
  const card = { fullName: 'A', gender: null, birthPlace: null, birthDate: '2000-01-01', nationality: 'MY', hasNik: false, passportLast4: null, passportIssuedAt: null, passportExpiry: null, phone: null, whatsapp: null, email: null, address: null }
  const out = snapshotFromCard([{ fieldKey: 'a', fieldType: 'text', role: 'display_name' }, { fieldKey: 'b', fieldType: 'text', role: 'birth_date' }, { fieldKey: 'c', fieldType: 'select', role: 'nationality' }, { fieldKey: 'd', fieldType: 'text', role: 'nik' }, { fieldKey: 'e', fieldType: 'text', role: null }], card)
  assert.deepEqual(out, { a: 'A', c: 'MY', d: null })
})

await t('ALAMAT (D1): bentuk + hierarki wilayah diperiksa server; `text` diturunkan dari nama DB (nilai klien dibuang); kosong = null; snapshot kartu ke field alamat', async () => {
  const w = `T${String(Date.now()).slice(-6)}`
  await prisma.addressProvince.create({ data: { id: w, name: 'Provinsi Uji' } })
  await prisma.addressRegency.create({ data: { id: `${w}.01`, provinceId: w, name: 'Kota Uji', type: 'kota' } })
  await prisma.addressDistrict.create({ data: { id: `${w}.01.01`, regencyId: `${w}.01`, name: 'Kecamatan Uji' } })
  await prisma.addressVillage.create({ data: { id: `${w}.01.01.2001`, districtId: `${w}.01.01`, name: 'Desa Uji' } })
  try {
    const fields = [{ fieldKey: 'alamat', label: 'Alamat', fieldType: 'address' }, { fieldKey: 'nama', label: 'Nama', fieldType: 'text' }]
    const good = { type: 'domestic', fullAddress: 'Jl. Uji 1', postalCode: '12345', provinceId: w, regencyId: `${w}.01`, districtId: `${w}.01.01`, villageId: `${w}.01.01.2001`, countryCode: null, city: '', stateRegion: '', text: 'PALSU dari klien' }
    const r = await resolveAddressValues(fields, { alamat: good, nama: 'X' })
    assert.ok(r.ok, JSON.stringify(r))
    const v = r.ok ? r.values.alamat as Record<string, unknown> : {}
    assert.equal(v.text, 'Jl. Uji 1, Desa Uji, Kecamatan Uji, Kota Uji, Provinsi Uji, 12345', 'teks dari nama DB, bukan klien')
    assert.equal(r.ok && r.values.nama, 'X', 'field lain tak disentuh')
    const wrong = await resolveAddressValues(fields, { alamat: { ...good, districtId: `${w}.99.99` } })
    assert.ok(!wrong.ok && /Kecamatan/.test(wrong.errors.alamat ?? ''), 'hierarki salah ditolak')
    const shape = await resolveAddressValues(fields, { alamat: { type: 'mars', fullAddress: 'x' } })
    assert.ok(!shape.ok, 'bentuk liar ditolak')
    const empty = await resolveAddressValues(fields, { alamat: { ...good, fullAddress: '' } })
    assert.ok(empty.ok && empty.values.alamat === null, 'alamat kosong (bawaan formulir) = null')
    assert.ok(validateFieldValues([{ fieldKey: 'alamat', label: 'Alamat', fieldType: 'address', required: true, options: null }], { alamat: 'teks bebas' }).ok === false, 'teks bebas tak lagi diterima field alamat')
    const card = { fullName: 'A', gender: null, birthPlace: null, birthDate: null, nationality: 'ID', hasNik: false, passportLast4: null, passportIssuedAt: null, passportExpiry: null, phone: null, whatsapp: null, email: null,
      address: { ...good, postalCode: '12345', city: null, stateRegion: null, text: 'Jl. Uji 1, Desa Uji' } }
    const snap = snapshotFromCard([{ fieldKey: 'a', fieldType: 'address', role: 'address' }, { fieldKey: 't', fieldType: 'textarea', role: 'address' }], card as Parameters<typeof snapshotFromCard>[1])
    assert.deepEqual(snap.a, card.address); assert.equal(snap.t, 'Jl. Uji 1, Desa Uji')
  } finally {
    await prisma.addressVillage.deleteMany({ where: { id: { startsWith: w } } })
    await prisma.addressDistrict.deleteMany({ where: { id: { startsWith: w } } })
    await prisma.addressRegency.deleteMany({ where: { id: { startsWith: w } } })
    await prisma.addressProvince.deleteMany({ where: { id: w } })
  }
})

/** Blok `{ … }` / `( … )` seimbang mulai dari indeks pembuka. */
function balanced(src: string, open: number): string {
  const pair: Record<string, string> = { '{': '}', '(': ')' }
  const stack: string[] = []
  for (let i = open; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '{' || ch === '(') stack.push(pair[ch]!)
    else if ((ch === '}' || ch === ')') && stack.pop() !== ch) return src.slice(open, i + 1)
    if (stack.length === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}
/** Kunci tingkat atas sebuah blok objek (abaikan isi bersarang). */
function topKeys(block: string): string[] {
  let depth = 0
  const keys: string[] = []
  const re = /([A-Za-z_]\w*)\s*:/y
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]!
    if (ch === '{' || ch === '(' || ch === '[') { depth++; continue }
    if (ch === '}' || ch === ')' || ch === ']') { depth--; continue }
    if (depth === 1) { re.lastIndex = i; const m = re.exec(block); if (m && /[\s,{]/.test(block[i - 1] ?? ' ')) { keys.push(m[1]!); i += m[0].length - 1 } }
  }
  return keys
}
/** Pembacaan jamaah booking yang membawa SEMUA kolom (termasuk cipher): `pilgrim(s): true`, relasi tanpa `select`, `bookingPilgrim.find*` tanpa `select`. */
function unsafePilgrimReads(raw: string): string[] {
  const src = raw.replace(/_count:\s*\{\s*select:\s*\{[^}]*\}\s*\}/g, '') // jumlah relasi, bukan baris
  const out: string[] = []
  if (/\b(pilgrims?|bookingPilgrims):\s*true\b/.test(src)) out.push('relasi pilgrim(s)/bookingPilgrims: true')
  for (const m of src.matchAll(/\b(pilgrims?|bookingPilgrims):\s*\{/g)) {
    const keys = topKeys(balanced(src, m.index! + m[0].length - 1))
    // Argumen BACA relasi (bukan filter `where`/tulis bersarang): tanpa `select` = semua kolom skalar ikut.
    const READ_ARGS = ['orderBy', 'where', 'take', 'skip', 'include', 'distinct', 'cursor', 'select']
    const isRead = keys.length > 0 && keys.every(k => READ_ARGS.includes(k))
    if (isRead && (!keys.includes('select') || keys.includes('include'))) out.push(`relasi pilgrim(s) tanpa select (${keys.join(',')})`)
  }
  for (const m of src.matchAll(/bookingPilgrim\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow)\(/g)) {
    const arg = balanced(src, m.index! + m[0].length - 1)
    const obj = arg.indexOf('{')
    if (!(obj >= 0 && topKeys(balanced(arg, obj)).includes('select'))) out.push(`bookingPilgrim.${m[1]} tanpa select`)
  }
  // Tulis tunggal mengembalikan SELURUH baris (termasuk cipher) bila tanpa `select`.
  for (const m of src.matchAll(/bookingPilgrim\.(update|create|upsert|delete)\(/g)) {
    const arg = balanced(src, m.index! + m[0].length - 1)
    const obj = arg.indexOf('{')
    if (!(obj >= 0 && topKeys(balanced(arg, obj)).includes('select'))) out.push(`bookingPilgrim.${m[1]} tanpa select`)
  }
  if (/SELECT\s+(\w+\.)?\*[\s\S]{0,300}?booking_pilgrims/i.test(src)) out.push('SELECT * dari booking_pilgrims')
  return out
}

await t('PENJAGA: penulis tunggal kolom tautan/segel; relasi pilgrims di app/ lewat select; daftar peran = CHECK migrasi', () => {
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(join(root, d))
  const bad: string[] = []
  const SEAL_OK = new Set(['lib/pilgrims/bookingLink.ts', 'lib/pilgrims/service.ts', 'lib/account/erasureSweep.ts', 'lib/validators/pilgrims.ts'])
  for (const f of files) {
    const rel = relative(root, f)
    const src = readFileSync(f, 'utf8')
    if (/\b(nikCipher|nikHash|passportCipher|passportKeyHash)\b/.test(src) && !SEAL_OK.has(rel)) bad.push(`${rel}: menyentuh kolom NIK/paspor tersegel`)
    if (/bookingPilgrim\.(update|updateMany|create|createMany|upsert)\(\{[\s\S]{0,300}?data:\s*\{[^}]*savedPilgrimId:(?!\s*null)/.test(src) && rel !== 'lib/pilgrims/bookingLink.ts') bad.push(`${rel}: menulis savedPilgrimId`)
    if (/bookingPilgrim\.(create|createMany|upsert)\(/.test(src) && rel !== 'lib/booking/lineItems.ts') bad.push(`${rel}: membuat jamaah booking di luar lib/booking/lineItems.ts (penyegel NIK/paspor)`)
    if (rel === 'lib/booking/lineItems.ts' && !/sealNewPilgrim\(/.test(src)) bad.push(`${rel}: jamaah baru tidak lewat sealNewPilgrim`)
    for (const problem of unsafePilgrimReads(src)) bad.push(`${rel}: ${problem} — pakai select (BOOKING_PILGRIM_SAFE_SELECT), bukan include/true (SEC-192)`)
    if (/['"]use client['"]/.test(src) && /from ['"]@\/lib\/pilgrims\/bookingLink['"]/.test(src.replace(/import type [^;]+;?/g, ''))) bad.push(`${rel}: komponen klien mengimpor layanan server`)
  }
  assert.deepEqual(bad, [])
  const sql = readFileSync(join(root, 'prisma/migrations/20261115090000_booking_pilgrim_cards/migration.sql'), 'utf8')
  const check = sql.slice(sql.indexOf('manifest_field_requirements_role_chk'))
  const listed = [...check.slice(0, check.indexOf(';')).matchAll(/'([a-z_]+)'/g)].map(m => m[1])
  assert.deepEqual(listed, [...MANIFEST_ROLES])
})

// ── pembersihan (DB uji) ────────────────────────────────────────────────────────────────────────────────────────────
const owned = { savedPilgrim: { ownerId: { in: users } } }
await prisma.pilgrimDocument.deleteMany({ where: owned })
await prisma.bookingPilgrim.updateMany({ where: { booking: { userId: { in: users } } }, data: { savedPilgrimId: null, identityId: null } })
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
const identityIds = (await prisma.savedPilgrim.findMany({ where: { ownerId: { in: users } }, select: { identityId: true } })).map(c => c.identityId).filter((x): x is string => !!x)
await prisma.savedPilgrim.deleteMany({ where: { ownerId: { in: users } } })
await prisma.pilgrimIdentity.deleteMany({ where: { id: { in: identityIds } } })
await prisma.documentRequirement.deleteMany({ where: { productId: { in: visas } } })
await prisma.manifestFieldRequirement.deleteMany({ where: { productId: { in: visas } } })
await prisma.visaProduct.deleteMany({ where: { id: { in: visas } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
