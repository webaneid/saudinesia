// Uji data jamaah tersimpan Fase 2 (docs/arsitektur-jamaah.md §4, §10; ADR-0005) terhadap DATABASE SUNGGUHAN.
// Inti: dedup identitas lewat NIK (baru / cocok / konflik / ganda sendiri / bayi / WNA), respons tanpa orakel, simpan serentak NIK sama →
// satu identitas (deterministik: kedua permintaan ditahan di kunci yang sama lalu dilepas bersamaan), cek kunci PII di DB (SEC-168),
// hapus-aman, dan perlakuan hapus akun. PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { consume, policy, __resetForTests } from '@/lib/auth/rateLimit'
import { ensurePiiKeysMatch, nikIndex, PiiKeyMismatchError, type Nik } from '@/lib/pii'
import { countErasableIdentities, createSavedPilgrim, deleteSavedPilgrim, eraseSavedPilgrimsOf, getSavedPilgrim, restoreSavedPilgrim, updateSavedPilgrim, type Actor, type WriteResult } from '@/lib/pilgrims/service'
import { nameKeyOf } from '@/lib/pilgrims/nameKey'
import { addDays, todayInApp } from '@/lib/time'
import { savedPilgrimInputSchema, type SavedPilgrimInput } from '@/lib/validators/pilgrims'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).stack?.split('\n').slice(0, 6).join('\n     ')}`)
  }
}

const env = process.env as Record<string, string | undefined>
const hex = () => randomBytes(32).toString('hex')
env.PII_INDEX_KEY = hex()
env.PII_ENCRYPTION_KEY = hex()
env.PII_ENCRYPTION_KEY_VERSION = '1'
delete env.PII_ENCRYPTION_KEYS_RETIRED
delete env.REDIS_URL // pembatas memakai memori proses → bisa direset per uji
__resetForTests()
await prisma.piiKeyCheck.deleteMany() // kunci acak per jalan; nilai cek jalan sebelumnya tak berlaku lagi

const tag = `pg${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim', isActive = true): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role, isActive }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}

// NIK uji: provinsi 32, tanggal lahir 15-07-1985 laki-laki → digit 7–12 = 150785; 4 digit urut acak per jalan.
const serialBase = 1000 + Math.floor(Math.random() * 7000)
let s = 0
const nik = () => `320101150785${String(serialBase + ++s).padStart(4, '0')}`
const base = (over: Partial<SavedPilgrimInput> = {}): SavedPilgrimInput =>
  savedPilgrimInputSchema.parse({ fullName: 'Budi Santoso', gender: 'male', birthDate: '1985-07-15', nationality: 'ID', ...over })

function okCard(r: WriteResult) {
  if (!r.ok) throw new Error(`diharapkan ok, dapat ${r.status} ${r.error}`)
  return r.card
}
const cardRow = (id: string) => prisma.savedPilgrim.findUniqueOrThrow({ where: { id } })
/** Respons tanpa bagian yang memang unik per baris; stempel waktu diganti selisihnya (SEC-173: selisih yang berbeda = orakel). */
const shape = (r: WriteResult) => {
  if (!r.ok) return r
  const { id, createdAt, updatedAt, ...rest } = r.card; void id
  return { ...r, card: { ...rest, editedAfterCreate: Date.parse(updatedAt) - Date.parse(createdAt) } }
}

await t('cek kunci PII (SEC-168): pemakaian pertama menulis nilai cek; kunci indeks/enkripsi lain → ditolak; kunci benar → lolos lagi', async () => {
  await ensurePiiKeysMatch()
  const rows = await prisma.piiKeyCheck.findMany({ orderBy: { id: 'asc' } })
  assert.deepEqual(rows.map(r => r.id), ['enc:1', 'index'])
  const good = { i: env.PII_INDEX_KEY, e: env.PII_ENCRYPTION_KEY }
  try {
    env.PII_INDEX_KEY = hex()
    await assert.rejects(ensurePiiKeysMatch(), PiiKeyMismatchError)
    env.PII_INDEX_KEY = good.i; env.PII_ENCRYPTION_KEY = hex()
    await assert.rejects(ensurePiiKeysMatch(), PiiKeyMismatchError)
    // rotasi sah: versi baru + kunci lama dipensiunkan → lolos, baris cek versi baru ditulis
    env.PII_ENCRYPTION_KEY_VERSION = '2'; env.PII_ENCRYPTION_KEYS_RETIRED = `1:${good.e}`
    await ensurePiiKeysMatch()
    assert.ok(await prisma.piiKeyCheck.findUnique({ where: { id: 'enc:2' } }))
    // kunci pensiun salah ketik → ketahuan lewat baris enc:1
    env.PII_ENCRYPTION_KEYS_RETIRED = `1:${hex()}`
    await assert.rejects(ensurePiiKeysMatch(), PiiKeyMismatchError)
  } finally {
    env.PII_INDEX_KEY = good.i; env.PII_ENCRYPTION_KEY = good.e; env.PII_ENCRYPTION_KEY_VERSION = '1'; delete env.PII_ENCRYPTION_KEYS_RETIRED
    await prisma.piiKeyCheck.deleteMany({ where: { id: 'enc:2' } })
  }
  await ensurePiiKeysMatch()
  // kontrol: layanan menolak menulis dengan kunci indeks yang salah (bukan diam-diam membuat identitas kedua)
  const a = await makeUser()
  env.PII_INDEX_KEY = hex()
  try { await assert.rejects(createSavedPilgrim(a, a.userId, base({ nik: nik() })), PiiKeyMismatchError) } finally { env.PII_INDEX_KEY = good.i }
  assert.equal(await prisma.savedPilgrim.count({ where: { ownerId: a.userId } }), 0)
})

await t('NIK baru → identitas dibuat + kartu matched; respons tanpa identityId/matchStatus/NIK; tak ada digit NIK di DB', async () => {
  const a = await makeUser()
  const value = nik()
  const r = await createSavedPilgrim(a, a.userId, base({ nik: value, birthPlace: 'Bandung' }))
  const card = okCard(r)
  const json = JSON.stringify(r)
  assert.ok(!json.includes(value) && !json.includes(value.slice(-4)) && !/identityId|matchStatus|nikHash|Cipher/.test(json), json)
  assert.equal(card.nik, '•••• •••• •••• ••••')
  const row = await cardRow(card.id)
  assert.equal(row.matchStatus, 'matched')
  assert.equal(row.nikHash, nikIndex(value as Nik))
  const identity = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { id: row.identityId! } })
  assert.equal(identity.nameKey, 'budi santoso')
  for (const v of [JSON.stringify(row), JSON.stringify(identity)]) assert.ok(!v.includes(value) && !v.includes(value.slice(-6)), 'digit NIK polos tersimpan')
  const ev = await prisma.pilgrimIdentityEvent.findMany({ where: { identityId: identity.id } })
  assert.deepEqual(ev.map(e => e.kind), ['created'])
})

await t('ORAKEL: akun Q menyimpan NIK baru / NIK milik akun lain (cocok) / NIK konflik dengan masukan sama → respons IDENTIK', async () => {
  const p1 = await makeUser(), p2 = await makeUser(), q = await makeUser()
  const existing = nik(), conflicting = nik(), fresh = nik()
  okCard(await createSavedPilgrim(p1, p1.userId, base({ nik: existing })))
  okCard(await createSavedPilgrim(p2, p2.userId, base({ nik: conflicting, fullName: 'Orang Lain Sekali', birthDate: '1985-07-15' })))
  const rFresh = await createSavedPilgrim(q, q.userId, base({ nik: fresh }))
  const rExisting = await createSavedPilgrim(q, q.userId, base({ nik: existing }))
  const rConflict = await createSavedPilgrim(q, q.userId, base({ nik: conflicting }))
  assert.deepEqual(shape(rExisting), shape(rFresh))
  assert.deepEqual(shape(rConflict), shape(rFresh))
  for (const r of [rFresh, rExisting, rConflict]) assert.equal(okCard(r).updatedAt, okCard(r).createdAt, 'stempel kartu baru harus sama — selisih membuka status (SEC-173)')
  // ... padahal di gudang ketiganya berbeda
  const statuses = await Promise.all([rFresh, rExisting, rConflict].map(r => cardRow(okCard(r).id).then(c => c.matchStatus)))
  assert.deepEqual(statuses, ['matched', 'matched', 'conflict'])
  const shared = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { nikHash: nikIndex(existing as Nik) }, include: { cards: true } })
  assert.equal(shared.cards.length, 2)
  // kartu Q tak pernah diisi data kanonik/kartu akun lain: nama kartu konflik tetap yang diketik Q
  assert.equal(okCard(rConflict).fullName, 'Budi Santoso')
})

await t('ORAKEL PASIF (SEC-173): kartu korban tak berubah sedikit pun (termasuk updatedAt) saat akun lain menyimpan/mengubah/menghapus NIK yang sama', async () => {
  const victim = await makeUser(), attacker = await makeUser()
  const v = nik()
  const vc = okCard(await createSavedPilgrim(victim, victim.userId, base({ nik: v, fullName: 'Nama Asli Korban' })))
  const before = await cardRow(vc.id)
  const a1 = okCard(await createSavedPilgrim(attacker, attacker.userId, base({ nik: v, fullName: 'Tebakan Pertama' })))
  okCard(await updateSavedPilgrim(attacker, attacker.userId, a1.id, base({ fullName: 'Nama Asli Korban' })))
  await deleteSavedPilgrim(attacker, attacker.userId, a1.id)
  const after = await cardRow(vc.id)
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime())
  assert.deepEqual(await getSavedPilgrim(victim, victim.userId, vc.id), vc)
})

await t('NIK ganda di daftar AKUN SENDIRI → 409 (satu-satunya penolakan terkait NIK); akun lain dengan NIK sama → lolos', async () => {
  const a = await makeUser(), b = await makeUser()
  const v = nik()
  okCard(await createSavedPilgrim(a, a.userId, base({ nik: v })))
  const dup = await createSavedPilgrim(a, a.userId, base({ nik: v.replace(/(\d{4})/g, '$1 ').trim() })) // spasi KTP dinormalisasi
  assert.ok(!dup.ok && dup.status === 409 && dup.field === 'nik', JSON.stringify(dup))
  okCard(await createSavedPilgrim(b, b.userId, base({ nik: v })))
})

await t('NIK wajib bagi WNI kecuali bayi < 2 tahun (batas tepat di hari ulang tahun ke-2); bayi tanpa NIK = unmatched tanpa identitas', async () => {
  const a = await makeUser()
  const today = todayInApp()
  const [y, m, d] = today.split('-')
  const turnsTwoToday = m === '02' && d === '29' ? `${Number(y) - 2}-03-01` : `${Number(y) - 2}-${m}-${d}`
  const noNik = await createSavedPilgrim(a, a.userId, base({ birthDate: '2000-01-01' }))
  assert.ok(!noNik.ok && noNik.status === 400 && noNik.field === 'nik')
  const two = await createSavedPilgrim(a, a.userId, base({ birthDate: turnsTwoToday }))
  assert.ok(!two.ok && two.field === 'nik', 'tepat 2 tahun hari ini bukan bayi lagi')
  const baby = okCard(await createSavedPilgrim(a, a.userId, base({ fullName: 'Bayi Uji', birthDate: addDays(turnsTwoToday, 1) })))
  const row = await cardRow(baby.id)
  assert.equal(row.matchStatus, 'unmatched'); assert.equal(row.identityId, null); assert.equal(baby.nik, null)
  const future = await createSavedPilgrim(a, a.userId, base({ birthDate: addDays(today, 1) }))
  assert.ok(!future.ok && future.field === 'birthDate')
  const badNik = await createSavedPilgrim(a, a.userId, base({ nik: '1234' }))
  assert.ok(!badNik.ok && badNik.status === 400 && badNik.field === 'nik')
})

await t('WNA: kunci identitas = negara + nomor paspor; nomor sama negara lain = orang lain; NIK untuk WNA ditolak; paspor tersamar', async () => {
  const a = await makeUser(), b = await makeUser()
  const number = `A${Date.now() % 10_000_000}`.padEnd(8, '7')
  const wna = (over: Partial<SavedPilgrimInput> = {}) => base({ nationality: 'MY', fullName: 'Ahmad Bin Ali', passport: { number, expiry: '2030-01-01' }, ...over })
  const c1 = okCard(await createSavedPilgrim(a, a.userId, wna()))
  assert.equal(c1.passport?.number, `••••${number.slice(-4)}`)
  assert.ok(!JSON.stringify(c1).includes(number))
  const c2 = okCard(await createSavedPilgrim(b, b.userId, wna({ passport: { number: number.toLowerCase() } })))
  const [r1, r2] = await Promise.all([cardRow(c1.id), cardRow(c2.id)])
  assert.ok(r1.identityId && r1.identityId === r2.identityId)
  const c3 = okCard(await createSavedPilgrim(b, b.userId, wna({ nationality: 'SG', passport: { number } })))
  assert.notEqual((await cardRow(c3.id)).identityId, r1.identityId)
  const withNik = await createSavedPilgrim(a, a.userId, wna({ nik: nik(), passport: { number: 'B7654321' } }))
  assert.ok(!withNik.ok && withNik.field === 'nik')
  const noPassport = await createSavedPilgrim(a, a.userId, base({ nationality: 'MY' }))
  assert.ok(!noPassport.ok && noPassport.field === 'passport.number')
  const badDates = await createSavedPilgrim(a, a.userId, wna({ passport: { number: 'C7654321', issuedAt: '2025-01-01', expiry: '2024-01-01' } }))
  assert.ok(!badDates.ok && badDates.field === 'passport.expiry')
})

await t('SERENTAK (deterministik): dua akun menyimpan NIK baru yang sama, keduanya ditahan di kunci identitas lalu dilepas → SATU identitas, dua kartu', async () => {
  const a = await makeUser(), b = await makeUser()
  const v = nik()
  const key = `pilgrim-identity:${nikIndex(v as Nik)}`
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let held!: () => void
  const holding = new Promise<void>(r => { held = r })
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    held()
    await gate
  }, { timeout: 30_000 })
  await holding
  // gate SELALU dilepas: assert yang gagal saat kunci dipegang tidak boleh membuat uji menggantung
  let both: Promise<WriteResult[]> | undefined
  try {
  both = Promise.all([createSavedPilgrim(a, a.userId, base({ nik: v })), createSavedPilgrim(b, b.userId, base({ nik: v }))])
  // tunggu sampai KEDUA permintaan benar-benar menunggu kunci advisory yang sama (bukan sekadar "mungkin sudah jalan")
  for (let i = 0; ; i++) {
    const rows = await prisma.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
    const waiting = rows[0]?.waiting ?? 0
    if (waiting >= 2) break
    if (i > 200) throw new Error(`hanya ${waiting} permintaan menunggu kunci`)
    await new Promise(r => setTimeout(r, 25))
  }
  } finally {
    release()
    await holder
  }
  const [ra, rb] = await both!
  okCard(ra!); okCard(rb!)
  const identities = await prisma.pilgrimIdentity.findMany({ where: { nikHash: nikIndex(v as Nik) }, include: { cards: true } })
  assert.equal(identities.length, 1)
  assert.equal(identities[0]!.cards.length, 2)
})

await t('URUTAN KUNCI (SEC-174, deterministik): dua akun mengubah kartu ber-NIK sama serentak (statusnya saling memengaruhi) → keduanya sukses, tanpa deadlock', async () => {
  const a = await makeUser(), b = await makeUser()
  const v = nik()
  const ca = okCard(await createSavedPilgrim(a, a.userId, base({ nik: v })))
  const cb = okCard(await createSavedPilgrim(b, b.userId, base({ nik: v })))
  const key = `pilgrim-identity:${nikIndex(v as Nik)}`
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let held!: () => void
  const holding = new Promise<void>(r => { held = r })
  const holder = prisma.$transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`; held(); await gate }, { timeout: 30_000 })
  await holding
  let both: Promise<WriteResult[]> | undefined
  try {
  // kartu tertua (A) ganti nama → kartu B jadi conflict; B ganti nama juga → settle menyentuh kartu A
  both = Promise.all([updateSavedPilgrim(a, a.userId, ca.id, base({ fullName: 'Nama Baru A' })), updateSavedPilgrim(b, b.userId, cb.id, base({ fullName: 'Nama Baru B' }))])
  for (let i = 0; ; i++) {
    const rows = await prisma.$queryRaw<{ waiting: number }[]>`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`
    if ((rows[0]?.waiting ?? 0) >= 2) break
    if (i > 200) throw new Error('kedua ubah tidak menunggu kunci identitas')
    await new Promise(r => setTimeout(r, 25))
  }
  // keduanya menunggu kunci identitas SEBELUM mengunci baris kartunya: tak ada kunci baris kartu yang dipegang
  const rowLocks = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE c.relname = 'saved_pilgrims' AND l.mode = 'RowShareLock'`
  assert.equal(rowLocks[0]?.n ?? 0, 0, 'kunci baris kartu diambil sebelum kunci identitas')
  } finally {
    release()
    await holder
    await both?.catch(() => undefined)
  }
  const [ra, rb] = await both!
  okCard(ra!); okCard(rb!)
  const statuses = [(await cardRow(ca.id)).matchStatus, (await cardRow(cb.id)).matchStatus]
  assert.deepEqual(statuses, ['matched', 'conflict'])
})

await t('ubah: tanpa kolom nik = NIK tetap; ganti NIK → lepas dari identitas lama (dipangkas bila tanpa kartu) dan tertaut ke yang baru', async () => {
  const a = await makeUser()
  const v1 = nik(), v2 = nik()
  const c = okCard(await createSavedPilgrim(a, a.userId, base({ nik: v1 })))
  const id1 = (await cardRow(c.id)).identityId!
  const kept = okCard(await updateSavedPilgrim(a, a.userId, c.id, base({ birthPlace: 'Garut' })))
  assert.equal((await cardRow(kept.id)).nikHash, nikIndex(v1 as Nik))
  okCard(await updateSavedPilgrim(a, a.userId, c.id, base({ nik: v2 })))
  const row = await cardRow(c.id)
  assert.equal(row.nikHash, nikIndex(v2 as Nik))
  assert.notEqual(row.identityId, id1)
  assert.equal(await prisma.pilgrimIdentity.count({ where: { id: id1 } }), 0, 'identitas lama tanpa kartu harus terhapus')
  // satu-satunya kartu identitas belum terverifikasi: salah ketik nama diperbaiki → data kanonik ikut, tetap matched
  okCard(await updateSavedPilgrim(a, a.userId, c.id, base({ fullName: 'Budi Santosa' })))
  const identity = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { id: row.identityId! } })
  assert.equal(identity.fullName, 'Budi Santosa')
  assert.equal((await cardRow(c.id)).matchStatus, 'matched')
})

await t('identitas bersama: kartu tertua jadi sumber data kanonik; kartu tertua dihapus → kanonik pindah ke kartu berikutnya, status dihitung ulang', async () => {
  const a = await makeUser(), b = await makeUser()
  const v = nik()
  const ca = okCard(await createSavedPilgrim(a, a.userId, base({ nik: v, fullName: 'Nama Salah' })))
  const cb = okCard(await createSavedPilgrim(b, b.userId, base({ nik: v })))
  assert.equal((await cardRow(cb.id)).matchStatus, 'conflict')
  const del = await deleteSavedPilgrim(a, a.userId, ca.id)
  assert.deepEqual(del, { ok: true, result: 'deleted' })
  const rb = await cardRow(cb.id)
  assert.equal(rb.matchStatus, 'matched')
  assert.equal((await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { id: rb.identityId! } })).fullName, 'Budi Santoso')
})

await t('hapus-aman: kartu dipakai booking → diarsipkan (ubah ditolak 409, pulihkan bisa); tak dipakai → terhapus beserta alamat', async () => {
  const a = await makeUser()
  // alamat internasional: data wilayah (provinsi dst.) tak ada di DB uji
  const withAddr = await createSavedPilgrim(a, a.userId, base({ nik: nik(), address: { type: 'international', fullAddress: 'Jalan Uji 1', countryCode: 'MY', city: 'Kuala Lumpur' } }))
  const card = okCard(withAddr)
  assert.ok(card.addressId)
  const booking = await prisma.booking.create({ data: { bookingCode: `BK-${tag}-${++n}`, userId: a.userId, status: 'active', season: 'regular', totalAmount: 0, pilgrims: { create: [{ savedPilgrimId: card.id, fieldValues: {} }] } } })
  assert.deepEqual(await deleteSavedPilgrim(a, a.userId, card.id), { ok: true, result: 'archived' })
  const upd = await updateSavedPilgrim(a, a.userId, card.id, base())
  assert.ok(!upd.ok && upd.status === 409)
  assert.equal(okCard(await restoreSavedPilgrim(a, a.userId, card.id)).archived, false)
  await prisma.booking.delete({ where: { id: booking.id } })
  assert.deepEqual(await deleteSavedPilgrim(a, a.userId, card.id), { ok: true, result: 'deleted' })
  assert.equal(await prisma.address.count({ where: { id: card.addressId! } }), 0)
})

await t('kepemilikan: akun lain → 404 (baca/ubah/hapus/pulihkan); staf atas nama pelanggan → createdById; pemilik staf/nonaktif → 422', async () => {
  const a = await makeUser(), b = await makeUser(), staff = await makeUser('admin'), off = await makeUser('pilgrim', false)
  const c = okCard(await createSavedPilgrim(a, a.userId, base({ nik: nik() })))
  assert.equal(await getSavedPilgrim(b, a.userId, c.id), null)
  assert.equal(await getSavedPilgrim(b, b.userId, c.id), null, 'kartu akun lain lewat ownerId sendiri')
  for (const r of [await updateSavedPilgrim(b, a.userId, c.id, base()), await updateSavedPilgrim(b, b.userId, c.id, base()), await deleteSavedPilgrim(b, b.userId, c.id), await restoreSavedPilgrim(b, b.userId, c.id)]) {
    assert.ok(!r.ok && r.status === 404, JSON.stringify(r))
  }
  const byStaff = okCard(await createSavedPilgrim(staff, a.userId, base({ nik: nik() })))
  assert.equal((await cardRow(byStaff.id)).createdById, staff.userId)
  assert.ok(await getSavedPilgrim(staff, a.userId, byStaff.id))
  const toStaff = await createSavedPilgrim(staff, staff.userId, base({ nik: nik() }))
  assert.ok(!toStaff.ok && toStaff.status === 422)
  const toOff = await createSavedPilgrim(staff, off.userId, base({ nik: nik() }))
  assert.ok(!toOff.ok && toOff.status === 422)
})

await t('"Saya sendiri": satu per akun (409 pada yang kedua); bisa dilepas lalu dipasang di kartu lain', async () => {
  const a = await makeUser()
  const c1 = okCard(await createSavedPilgrim(a, a.userId, base({ nik: nik(), isSelf: true })))
  assert.equal(c1.isSelf, true)
  const c2 = await createSavedPilgrim(a, a.userId, base({ nik: nik(), isSelf: true }))
  assert.ok(!c2.ok && c2.status === 409 && c2.field === 'isSelf')
  okCard(await updateSavedPilgrim(a, a.userId, c1.id, base({ isSelf: false })))
  assert.equal(okCard(await createSavedPilgrim(a, a.userId, base({ nik: nik(), isSelf: true }))).isSelf, true)
})

await t('validator .strict(): kolom liar (ownerId, identityId, matchStatus, nikHash) ditolak', async () => {
  for (const extra of ['ownerId', 'identityId', 'matchStatus', 'nikHash', 'createdById']) {
    assert.equal(savedPilgrimInputSchema.safeParse({ fullName: 'Budi Santoso', birthDate: '1985-07-15', [extra]: 'x' }).success, false, extra)
  }
  assert.equal(savedPilgrimInputSchema.safeParse({ fullName: 'Budi Santoso', birthDate: '1899-12-31' }).success, false, 'tanggal lahir sebelum 1900')
  assert.equal(savedPilgrimInputSchema.safeParse({ fullName: 'Budi Santoso', birthDate: '1900-01-01' }).success, true)
})

await t('rate limit per akun: batas habis → 429 tanpa menulis apa pun; staf memakai batas tersendiri', async () => {
  __resetForTests()
  const a = await makeUser()
  for (let i = 0; i < 60; i++) await consume(policy('pilgrimWriteUser', a.userId))
  const r = await createSavedPilgrim(a, a.userId, base({ nik: nik() }))
  assert.ok(!r.ok && r.status === 429 && (r.retryAfterSec ?? 0) > 0)
  assert.equal(await prisma.savedPilgrim.count({ where: { ownerId: a.userId } }), 0)
  const staff = await makeUser('admin')
  okCard(await createSavedPilgrim(staff, a.userId, base({ nik: nik() })))
  __resetForTests()
})

await t('kunci nama: gelar & tanda baca dibuang, ejaan beda TIDAK disamakan', async () => {
  assert.equal(nameKeyOf('H. Ahmad   Fauzi, S.Kom'), 'ahmad fauzi')
  assert.equal(nameKeyOf('Hj. Siti Nur’aini'), 'siti nur aini')
  assert.equal(nameKeyOf('MUHAMMAD Rizki'), 'muhammad rizki')
  assert.notEqual(nameKeyOf('Mohammad Rizki'), nameKeyOf('Muhammad Rizki'))
  assert.equal(nameKeyOf('Haji'), 'haji') // satu kata gelar tetap nama
})

await t('hapus akun: kartu + alamat hilang, identitas hanya-milik-akun terhapus (pratinjau akurat), identitas bersama tetap dengan kanonik dari kartu tersisa', async () => {
  const u = await makeUser(), v = await makeUser()
  const own = nik(), shared = nik()
  const c1 = okCard(await createSavedPilgrim(u, u.userId, base({ nik: own, address: { type: 'international', fullAddress: 'Jalan Rahasia 9', countryCode: 'MY', city: 'Ipoh' } })))
  okCard(await createSavedPilgrim(u, u.userId, base({ nik: shared, fullName: 'Versi U' })))
  const cv = okCard(await createSavedPilgrim(v, v.userId, base({ nik: shared })))
  assert.equal((await cardRow(cv.id)).matchStatus, 'conflict')
  const booking = await prisma.booking.create({ data: { bookingCode: `BK-${tag}-${++n}`, userId: u.userId, status: 'completed', season: 'regular', totalAmount: 0, pilgrims: { create: [{ savedPilgrimId: c1.id, identityId: (await cardRow(c1.id)).identityId, fieldValues: {} }] } }, include: { pilgrims: true } })
  assert.equal(await countErasableIdentities(prisma, u.userId), 1)
  const out = await prisma.$transaction(tx => eraseSavedPilgrimsOf(tx, u.userId))
  assert.deepEqual(out, { savedPilgrims: 2, identities: 1, unlinkedManifest: 2 })
  assert.equal(await prisma.savedPilgrim.count({ where: { ownerId: u.userId } }), 0)
  assert.equal(await prisma.address.count({ where: { id: c1.addressId! } }), 0)
  assert.equal(await prisma.pilgrimIdentity.count({ where: { nikHash: nikIndex(own as Nik) } }), 0)
  const sharedId = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { nikHash: nikIndex(shared as Nik) } })
  assert.equal(sharedId.fullName, 'Budi Santoso')
  assert.equal((await cardRow(cv.id)).matchStatus, 'matched')
  const bp = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: booking.pilgrims[0]!.id } })
  assert.equal(bp.savedPilgrimId, null); assert.equal(bp.identityId, null)
  const trail = await prisma.pilgrimIdentityEvent.findMany({ where: { identityId: sharedId.id } })
  assert.ok(trail.length > 0 && trail.every(e => e.actorId !== u.userId), 'jejak identitas bersama masih menunjuk akun terhapus')
  await prisma.booking.delete({ where: { id: booking.id } })
})

// Bersihkan (DB uji): kartu → identitas → pengguna (ownerId Restrict).
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
await prisma.savedPilgrim.deleteMany({ where: { ownerId: { in: users } } })
await prisma.pilgrimIdentity.deleteMany({ where: { cards: { none: {} }, bookingPilgrims: { none: {} } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()

if (failed > 0) { console.log(`\n${failed} uji GAGAL`); process.exit(1) }
console.log('\nSemua uji data jamaah (Fase 2) lulus')
