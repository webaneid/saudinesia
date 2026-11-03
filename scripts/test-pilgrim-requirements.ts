// Syarat dokumen GABUNGAN per jamaah booking (lib/documents/requirements.ts `pilgrimRequirements`, docs/rencana-visa-produk.md §3.2/§3.5, V4c)
// terhadap DATABASE SUNGGUHAN: urutan Paket → Haji → Visa, satu baris per jenis, wajib bila salah satu mewajibkan, label dari produk pertama,
// sumber = nama produk peminta; checklist admin/jamaah (`bookingChecklists`) dan pengajuan (`submitPilgrim`) memakai gabungan itu; dokumen kartu
// berubah membuka ulang jamaah terverifikasi bila jenisnya diminta produk MANA PUN (bukan visa saja); jenis yang tak diminta tidak membuka ulang;
// penjaga sumber: tak ada pembaca syarat per-visa di jalur jamaah.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { __resetForTests } from '@/lib/auth/rateLimit'
import { createSavedPilgrim, type Actor } from '@/lib/pilgrims/service'
import { bookingChecklists } from '@/lib/pilgrims/bookingLink'
import { reopenForChangedDocument, submitPilgrim } from '@/lib/pilgrims/review'
import { pilgrimRequirements, writeRequirements } from '@/lib/documents/requirements'
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
delete env.RESEND_API_KEY
__resetForTests()
await prisma.piiKeyCheck.deleteMany()

const tag = `pr${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role, emailVerifiedAt: new Date() }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}
const staff = await makeUser('admin')
const owner = await makeUser()

const types = Object.fromEntries((await prisma.documentType.findMany()).map(x => [x.key, x]))
const T = (k: string) => types[k]!.id
const pkg = await prisma.package.create({ data: { name: `${tag} Paket Hemat` }, select: { id: true, name: true } })
const haji = await prisma.hajiProduct.create({ data: { name: `${tag} Haji Plus`, hajiType: 'plus', year: 2027 }, select: { id: true, name: true } })
const visa = await prisma.visaProduct.create({ data: { name: `${tag} Visa Umroh`, visaType: 'Umroh' }, select: { id: true, name: true } })
const visaOther = await prisma.visaProduct.create({ data: { name: `${tag} Visa Lain`, visaType: 'Umroh' }, select: { id: true, name: true } })
await prisma.$transaction(async tx => {
  await writeRequirements(tx, 'package', pkg.id, [
    { documentTypeId: T('kk'), label: 'KK (paket)', description: 'Terbaru', required: false },
    { documentTypeId: T('vaccine'), label: null, description: '', required: true },
  ])
  await writeRequirements(tx, 'haji', haji.id, [
    { documentTypeId: T('ktp'), label: null, description: '', required: true },
  ])
  await writeRequirements(tx, 'visa', visa.id, [
    { documentTypeId: T('passport'), label: null, description: '', required: true },
    { documentTypeId: T('kk'), label: 'KK (visa)', description: 'Legalisir', required: true },
  ])
  await writeRequirements(tx, 'visa', visaOther.id, [{ documentTypeId: T('flight_ticket'), label: null, description: '', required: true }])
})

const card = await (async () => {
  const r = await createSavedPilgrim(staff, owner.userId, savedPilgrimInputSchema.parse({ fullName: 'Siti Aminah', gender: 'female', birthPlace: 'Bogor', birthDate: '1990-02-03', nationality: 'ID', nik: `3201014302900${String(Date.now()).slice(-3).padStart(3, '1')}` }))
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
  return r.card.id
})()

// Satu booking: p1 anggota paket + visa paket, p2 anggota haji, p3 visa sendiri saja, p4 tanpa produk bersyarat.
const bk = await prisma.booking.create({
  data: { bookingCode: `BK-${tag}`, userId: owner.userId, status: 'active', season: 'regular', totalAmount: 1, pilgrims: { create: [0, 1, 2, 3].map(i => ({ isLeader: i === 0, fieldValues: {} })) } },
  select: { id: true, pilgrims: { select: { id: true }, orderBy: { id: 'asc' } } },
})
const [p1, p2, p3, p4] = bk.pilgrims.map(p => p.id) as [string, string, string, string]
const bp = await prisma.bookingPackage.create({ data: { bookingId: bk.id, packageId: pkg.id, departureDate: new Date('2026-12-01'), returnDate: new Date('2026-12-10'), numPeople: 1, totalPrice: 1 }, select: { id: true } })
const bh = await prisma.bookingHaji.create({ data: { bookingId: bk.id, hajiProductId: haji.id, totalPrice: 1 }, select: { id: true } })
await prisma.bookingPilgrim.update({ where: { id: p1 }, data: { bookingPackageId: bp.id, savedPilgrimId: card }, select: { id: true } })
await prisma.bookingPilgrim.update({ where: { id: p2 }, data: { bookingHajiId: bh.id }, select: { id: true } })
await prisma.visaApplication.create({ data: { bookingPilgrimId: p1, visaType: 'umrah', visaProductId: visa.id } })
await prisma.visaApplication.create({ data: { bookingPilgrimId: p3, visaType: 'umrah', visaProductId: visaOther.id } })

await t('GABUNGAN: Paket → Haji → Visa; satu baris per jenis; wajib bila salah satu mewajibkan; label produk pertama; petunjuk digabung; sumber per produk', async () => {
  const m = await pilgrimRequirements(prisma, [p1, p2, p3, p4])
  assert.deepEqual(m.get(p1)!.map(r => [r.key, r.required, r.label, r.description, r.sources]), [
    ['kk', true, 'KK (paket)', 'Terbaru · Legalisir', [pkg.name, visa.name]],
    ['vaccine', true, types.vaccine!.label, '', [pkg.name]],
    ['passport', true, types.passport!.label, '', [visa.name]],
  ])
  assert.deepEqual(m.get(p2)!.map(r => [r.key, r.sources]), [['ktp', [haji.name]]])
  assert.deepEqual(m.get(p3)!.map(r => [r.key, r.sources]), [['flight_ticket', [visaOther.name]]])
  assert.deepEqual(m.get(p4), [])
  assert.equal((await pilgrimRequirements(prisma, [])).size, 0)
})

await t('CHECKLIST admin/jamaah: memakai gabungan (termasuk syarat paket/haji tanpa visa) + sumber "Diminta oleh"', async () => {
  const m = await bookingChecklists(bk.id, null, [p1, p2, p3, p4].map(id => ({ id, savedPilgrimId: id === p1 ? card : null, plannedTravelDate: null })))
  assert.deepEqual(m.get(p1)!.items.map(i => [i.key, i.state, i.sources]), [['kk', 'missing', [pkg.name, visa.name]], ['vaccine', 'missing', [pkg.name]], ['passport', 'missing', [visa.name]]])
  assert.deepEqual(m.get(p2)!.items.map(i => i.key), ['ktp'], 'anggota haji tanpa visa tetap punya syarat')
  assert.equal(m.get(p4)!.items.length, 0)
})

await t('AJUKAN: penilai memakai gabungan — dokumen yang hanya diminta paket ikut disebut (422)', async () => {
  const r = await submitPilgrim(owner, bk.id, p1)
  assert.ok(!r.ok && r.status === 422 && r.error.includes(types.vaccine!.label) && r.error.includes(types.passport!.label), JSON.stringify(r))
})

await t('BUKA ULANG: dokumen kartu berubah → jamaah terverifikasi dibuka ulang bila jenisnya diminta PAKET (bukan visa); jenis tak diminta → tetap', async () => {
  const verify = () => prisma.bookingPilgrim.update({ where: { id: p1 }, data: { reviewStatus: 'verified', submittedAt: new Date(), verifiedAt: new Date(), verifiedById: staff.userId }, select: { id: true } })
  await verify()
  const none = await prisma.$transaction(tx => reopenForChangedDocument(tx, { savedPilgrimId: card, bookingId: null, documentTypeId: T('flight_ticket') }, staff.userId, 'uji'))
  assert.equal(none, 0, 'tiket tak diminta produk p1')
  const byPkg = await prisma.$transaction(tx => reopenForChangedDocument(tx, { savedPilgrimId: card, bookingId: null, documentTypeId: T('vaccine') }, staff.userId, 'uji'))
  assert.equal(byPkg, 1, 'vaksin hanya diminta paket — dulu (visa saja) tidak dibuka ulang')
  assert.equal((await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: p1 }, select: { reviewStatus: true } })).reviewStatus, 'submitted')
})

await t('PENJAGA: jalur jamaah membaca syarat HANYA lewat pilgrimRequirements — tak ada requirementsOf/requirementsOfMany/documentRequirement per visa', () => {
  for (const f of ['lib/pilgrims/review.ts', 'lib/pilgrims/bookingLink.ts', 'lib/documents/review.ts', 'lib/documents/service.ts',
    'app/[locale]/admin/(protected)/bookings/[id]/page.tsx', 'app/[locale]/(pilgrim)/bookings/[id]/page.tsx']) {
    const s = readFileSync(f, 'utf8')
    assert.ok(!/requirementsOf(Many)?\(|documentRequirement\.(count|find)/.test(s), `${f}: pembaca syarat langsung`)
  }
  for (const f of ['lib/pilgrims/review.ts', 'lib/pilgrims/bookingLink.ts']) assert.match(readFileSync(f, 'utf8'), /pilgrimRequirements\(/, f)
})

// ── bersih-bersih ──────────────────────────────────────────────────────────────────────────────────────────────────────
await prisma.booking.delete({ where: { id: bk.id } })
await prisma.documentRequirement.deleteMany({ where: { productId: { in: [pkg.id, haji.id, visa.id, visaOther.id] } } })
await prisma.package.delete({ where: { id: pkg.id } })
await prisma.hajiProduct.delete({ where: { id: haji.id } })
await prisma.visaProduct.deleteMany({ where: { id: { in: [visa.id, visaOther.id] } } })
await prisma.savedPilgrim.deleteMany({ where: { ownerId: owner.userId } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()
if (failed) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
