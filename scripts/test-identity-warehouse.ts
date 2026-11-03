// Uji gudang identitas jamaah untuk staf (lib/pilgrims/warehouse.ts, docs/arsitektur-jamaah.md §4.4, Fase 8) terhadap DATABASE SUNGGUHAN:
// peran (bukan staf = 404 di semua fungsi + setiap route memanggil requireAdmin), cari NIK tepat lewat indeks HMAC/alias + cari nama, buka
// NIK/paspor berjejak, cocok manual lengket & gugur saat kartu diubah, lepas → pesan generik + tak tertaut ulang sampai NIK diubah, pin kanonik
// menahan "kartu tertua", gabung → kartu/jamaah booking/jejak pindah dan kunci lama jadi alias (kartu berkunci lama tetap ke tujuan),
// hapus identitas ditolak bila pernah dipakai booking, kartu bayi tanpa NIK ditautkan petugas, updatedAt kartu tak bergeser (SEC-173),
// jejak tanpa PII, dan penjaga penulis tunggal.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { __resetForTests } from '@/lib/auth/rateLimit'
import { createSavedPilgrim, getSavedPilgrim, updateSavedPilgrim, type Actor } from '@/lib/pilgrims/service'
import { actOnCard, eraseIdentity, getIdentity, linkUnmatchedCard, listIdentities, listUnmatchedCards, mergeIdentities, revealIdentity } from '@/lib/pilgrims/warehouse'
import { savedPilgrimInputSchema } from '@/lib/validators/pilgrims'
import { addDays, todayInApp } from '@/lib/time'
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

const tag = `iw${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role, emailVerifiedAt: new Date() }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}
// NIK uji: provinsi 32, lahir 15-07-1985 laki-laki (digit 7–12 = 150785), 4 digit urut berbeda per jalan.
const base4 = Number(String(Date.now()).slice(-3)) * 10
const nikOf = (i: number) => `320101150785${String((base4 + i) % 10000).padStart(4, '0')}`
const card = async (actor: Actor, input: Record<string, unknown>) => {
  const r = await createSavedPilgrim(actor, actor.userId, savedPilgrimInputSchema.parse({ gender: 'male', birthPlace: 'Bandung', birthDate: '1985-07-15', nationality: 'ID', ...input }))
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
  return r.card.id
}
const update = async (actor: Actor, id: string, input: Record<string, unknown>) => {
  const r = await updateSavedPilgrim(actor, actor.userId, id, savedPilgrimInputSchema.parse({ gender: 'male', birthPlace: 'Bandung', birthDate: '1985-07-15', nationality: 'ID', ...input }))
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
}
const row = (id: string) => prisma.savedPilgrim.findUniqueOrThrow({ where: { id }, select: { identityId: true, matchStatus: true, matchConfirmedAt: true, nikCheckRequestedAt: true, updatedAt: true } })
const page = { page: 1, limit: 20, skip: 0 }

const staff = await makeUser('admin')
const [a, b, c] = [await makeUser(), await makeUser(), await makeUser()]
const NIK1 = nikOf(1)
const cardA = await card(a, { fullName: 'Budi Santoso', nik: NIK1 })
const cardB = await card(b, { fullName: 'Budi Santosa', nik: NIK1 })
const I1 = (await row(cardA)).identityId!

await t('PERAN: bukan staf → 404/null di setiap fungsi gudang; setiap route gudang memanggil requireAdmin', async () => {
  const r1 = await listIdentities(a, page); assert.ok('ok' in r1 && r1.status === 404)
  assert.equal(await getIdentity(a, I1), null)
  assert.equal(await listUnmatchedCards(a, page), null)
  for (const r of [await revealIdentity(a, I1, { field: 'nik' }), await actOnCard(a, I1, cardB, 'confirm'), await mergeIdentities(a, I1, I1), await eraseIdentity(a, I1), await linkUnmatchedCard(a, cardA, I1)]) {
    assert.deepEqual(!r.ok && r.status, 404)
  }
  const routes = execSync('find app/api/v1/admin/identities -name route.ts', { encoding: 'utf8' }).split('\n').filter(Boolean)
  assert.ok(routes.length >= 7, routes.join(','))
  for (const f of routes) {
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/export async function (GET|POST|PUT|DELETE)/g)) assert.ok(src.includes('await requireAdmin()'), `${f} ${m[1]}`)
  }
})

await t('CARI: NIK 16 digit (spasi diabaikan) → tepat lewat indeks; nama lewat kunci nama; filter konflik; tak ada digit NIK di respons', async () => {
  const byNik = await listIdentities(staff, { ...page, q: `${NIK1.slice(0, 6)} ${NIK1.slice(6)}` })
  assert.ok(!('ok' in byNik)); assert.deepEqual(byNik.items.map(i => i.id), [I1])
  const byName = await listIdentities(staff, { ...page, q: 'BUDI santoso' })
  assert.ok(!('ok' in byName) && byName.items.some(i => i.id === I1))
  const conflict = await listIdentities(staff, { ...page, filter: 'conflict' })
  assert.ok(!('ok' in conflict) && conflict.items.some(i => i.id === I1 && i.conflicts === 1))
  const d = await getIdentity(staff, I1)
  assert.ok(d); assert.deepEqual(d.cards.map(x => x.status), ['matched', 'conflict'])
  assert.ok(!JSON.stringify([byNik, d]).includes(NIK1.slice(-6)), 'digit NIK di respons')
})

await t('BUKA NIK: nilai utuh hanya dari revealIdentity + jejak nik_revealed atas nama petugas; identitas WNA → 404 untuk NIK', async () => {
  const r = await revealIdentity(staff, I1, { field: 'nik' })
  assert.ok(r.ok && r.value === NIK1)
  const ev = await prisma.pilgrimIdentityEvent.findFirstOrThrow({ where: { identityId: I1, kind: 'nik_revealed' } })
  assert.equal(ev.actorId, staff.userId)
})

await t('BUKA PASPOR per kartu WNA (berjejak); kartu identitas lain → 404', async () => {
  const w = await card(c, { fullName: 'John Smith', nationality: 'GB', nik: null, passport: { number: `GB${base4}77` } })
  const wid = (await row(w)).identityId!
  const r = await revealIdentity(staff, wid, { field: 'passport', cardId: w })
  assert.ok(r.ok && r.value === `GB${base4}77`)
  assert.equal(await prisma.pilgrimIdentityEvent.count({ where: { identityId: wid, kind: 'passport_revealed', cardId: w } }), 1)
  const wrong = await revealIdentity(staff, I1, { field: 'passport', cardId: w })
  assert.deepEqual(!wrong.ok && wrong.status, 404)
  const nikOfWna = await revealIdentity(staff, wid, { field: 'nik' })
  assert.deepEqual(!nikOfWna.ok && nikOfWna.status, 404)
})

await t('COCOK MANUAL: konflik → matched, lengket saat identitas dirapikan ulang, updatedAt kartu tak bergeser; gugur saat nama kartu diubah', async () => {
  const before = await row(cardB)
  const r = await actOnCard(staff, I1, cardB, 'confirm')
  assert.ok(r.ok)
  const after = await row(cardB)
  assert.deepEqual([after.matchStatus, !!after.matchConfirmedAt], ['matched', true])
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'SEC-173')
  await update(a, cardA, { fullName: 'Budi Santoso', nik: NIK1, birthPlace: 'Garut' }) // settleIdentity berjalan
  assert.equal((await row(cardB)).matchStatus, 'matched')
  const again = await actOnCard(staff, I1, cardB, 'confirm')
  assert.deepEqual(!again.ok && again.status, 409)
  await update(b, cardB, { fullName: 'Budi Santosa Bin Ali', nik: NIK1 })
  const gone = await row(cardB)
  assert.deepEqual([gone.matchStatus, gone.matchConfirmedAt], ['conflict', null])
})

await t('LEPAS (NIK tidak sesuai): kartu tanpa identitas + pesan generik ke pemilik; simpan tanpa ubah NIK tetap lepas; NIK diubah → tertaut & pesan hilang', async () => {
  const before = await row(cardB)
  assert.ok((await actOnCard(staff, I1, cardB, 'detach')).ok)
  const r = await row(cardB)
  assert.deepEqual([r.identityId, r.matchStatus, !!r.nikCheckRequestedAt], [null, 'unmatched', true])
  assert.equal(r.updatedAt.getTime(), before.updatedAt.getTime(), 'SEC-173')
  assert.equal((await getSavedPilgrim(b, b.userId, cardB))?.needsNikCheck, true)
  await update(b, cardB, { fullName: 'Budi Santosa', nik: NIK1, birthPlace: 'Bogor' })
  assert.equal((await row(cardB)).identityId, null, 'tak tertaut ulang selama NIK sama')
  assert.equal((await getSavedPilgrim(b, b.userId, cardB))?.needsNikCheck, true)
  const NIK2 = nikOf(2)
  await update(b, cardB, { fullName: 'Budi Santosa', nik: NIK2 })
  const x = await row(cardB)
  assert.ok(x.identityId && x.identityId !== I1); assert.equal(x.nikCheckRequestedAt, null)
  assert.equal((await getSavedPilgrim(b, b.userId, cardB))?.needsNikCheck, false)
  const ev = await prisma.pilgrimIdentityEvent.findFirstOrThrow({ where: { identityId: I1, kind: 'detached', cardId: cardB } })
  assert.equal(ev.actorId, staff.userId)
})

await t('PIN KANONIK: data kartu dipilih petugas jadi kanonik dan TIDAK digeser kartu tertua saat identitas dirapikan', async () => {
  const cardC = await card(c, { fullName: 'Budiman Santoso', nik: NIK1 })
  assert.ok((await actOnCard(staff, I1, cardC, 'pin')).ok)
  await update(a, cardA, { fullName: 'Budi Santoso', nik: NIK1, birthPlace: 'Cianjur' })
  const i = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { id: I1 }, select: { fullName: true, canonicalPinnedAt: true } })
  assert.equal(i.fullName, 'Budiman Santoso'); assert.ok(i.canonicalPinnedAt)
  const d = await getIdentity(staff, I1)
  assert.deepEqual(d!.cards.map(x => [x.id, x.status]), [[cardA, 'conflict'], [cardC, 'matched']])
})

const d1 = await makeUser(); const d2 = await makeUser(); const d3 = await makeUser()
const NIK3 = nikOf(3); const NIK4 = nikOf(4)
const s1 = await card(d1, { fullName: 'Siti Aminah', nik: NIK3, gender: 'female', birthDate: '1985-07-15' })
const s2 = await card(d2, { fullName: 'Siti Aminah', nik: NIK4, gender: 'female', birthDate: '1985-07-15' })
const I3 = (await row(s1)).identityId!
const I4 = (await row(s2)).identityId!

await t('GABUNG: petugas memilih identitas yang dipakai; kartu/jamaah booking/jejak pindah, kunci lama jadi alias, identitas lama hilang', async () => {
  const bk = await prisma.booking.create({ data: { bookingCode: `BK-${tag}-1`, userId: d2.userId, status: 'active', season: 'regular', totalAmount: 1, pilgrims: { create: [{ isLeader: true, fieldValues: {}, identityId: I4 }] } }, select: { id: true } })
  const self = await mergeIdentities(staff, I3, I3)
  assert.deepEqual(!self.ok && self.status, 400)
  const r = await mergeIdentities(staff, I3, I4)
  assert.ok(r.ok && r.identityId === I3)
  assert.equal(await prisma.pilgrimIdentity.count({ where: { id: I4 } }), 0)
  assert.equal((await row(s2)).identityId, I3)
  assert.equal(await prisma.bookingPilgrim.count({ where: { bookingId: bk.id, identityId: I3 } }), 1)
  assert.equal(await prisma.pilgrimIdentityAlias.count({ where: { identityId: I3, kind: 'nik' } }), 1)
  assert.ok(await prisma.pilgrimIdentityEvent.count({ where: { identityId: I3, kind: 'merged' } }) === 1)
  assert.ok(await prisma.pilgrimIdentityEvent.count({ where: { identityId: I3, cardId: s2, kind: 'created' } }) === 1, 'jejak lama ikut pindah')
  const ev = await prisma.pilgrimIdentityEvent.findFirstOrThrow({ where: { identityId: I3, kind: 'merged' } })
  assert.ok(!JSON.stringify(ev.detail).includes(NIK4.slice(-6)))
})

await t('ALIAS: kartu berkunci lama tetap ke identitas tujuan saat diedit; akun baru dengan NIK lama ikut tertaut; cari NIK lama menemukan tujuan', async () => {
  await update(d2, s2, { fullName: 'Siti Aminah', nik: NIK4, gender: 'female', birthPlace: 'Depok' })
  assert.equal((await row(s2)).identityId, I3)
  const s3 = await card(d3, { fullName: 'Siti Aminah', nik: NIK4, gender: 'female' })
  assert.equal((await row(s3)).identityId, I3)
  const found = await listIdentities(staff, { ...page, q: NIK4 })
  assert.ok(!('ok' in found)); assert.deepEqual(found.items.map(i => i.id), [I3])
  assert.equal(await prisma.pilgrimIdentity.count({ where: { nikHash: { not: null }, cards: { some: { id: { in: [s2, s3] } } }, NOT: { id: I3 } } }), 0)
})

await t('GABUNG SERENTAK dengan edit kartu berkunci yang digabung: keduanya selesai (berhasil atau 409), tanpa deadlock; kartu berakhir di tujuan', async () => {
  for (let k = 0; k < 4; k++) {
    const u1 = await makeUser(); const u2 = await makeUser()
    const x1 = await card(u1, { fullName: `Rahmat ${k}`, nik: nikOf(10 + k * 2) })
    const x2 = await card(u2, { fullName: `Rahmat ${k}`, nik: nikOf(11 + k * 2) })
    const keep = (await row(x1)).identityId!; const drop = (await row(x2)).identityId!
    const [m, w] = await Promise.all([
      mergeIdentities(staff, keep, drop),
      updateSavedPilgrim(u2, u2.userId, x2, savedPilgrimInputSchema.parse({ fullName: `Rahmat ${k}`, gender: 'male', birthDate: '1985-07-15', nationality: 'ID', nik: nikOf(11 + k * 2), birthPlace: 'Solo' })),
    ])
    assert.ok(m.ok || m.status === 409, JSON.stringify(m)); assert.ok(w.ok || w.status === 409, JSON.stringify(w))
    if (m.ok) assert.equal((await row(x2)).identityId, keep)
  }
})

await t('HAPUS: identitas pernah dipakai booking → 409; tanpa booking → identitas/alias/jejak hilang, kartu dilepas, jejak hapus tanpa PII', async () => {
  const used = await eraseIdentity(staff, I3)
  assert.deepEqual(!used.ok && used.status, 409)
  const e = await makeUser()
  const ce = await card(e, { fullName: 'Hapus Saja', nik: nikOf(40) })
  const ie = (await row(ce)).identityId!
  const before = await row(ce)
  const r = await eraseIdentity(staff, ie)
  assert.ok(r.ok && r.cardsDetached === 1)
  assert.equal(await prisma.pilgrimIdentity.count({ where: { id: ie } }), 0)
  assert.equal(await prisma.pilgrimIdentityEvent.count({ where: { identityId: ie } }), 0)
  const after = await row(ce)
  assert.deepEqual([after.identityId, after.matchStatus], [null, 'unmatched'])
  assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), 'SEC-173')
  const er = await prisma.pilgrimIdentityErasure.findFirstOrThrow({ where: { actorId: staff.userId }, orderBy: { createdAt: 'desc' } })
  assert.deepEqual([er.reason, er.cardsDetached, er.revealEvents], ['staff_erase', 1, 0])
})

await t('JEJAK BUKA NIK TAK HILANG (SEC-207): buka NIK lalu lepas kartu terakhir → identitas terhapus, baris jejak hapus mencatat pembukaannya', async () => {
  const h = await makeUser()
  const ch = await card(h, { fullName: 'Jejak Tetap', nik: nikOf(41) })
  const ih = (await row(ch)).identityId!
  assert.ok((await revealIdentity(staff, ih, { field: 'nik' })).ok)
  const r = await actOnCard(staff, ih, ch, 'detach')
  assert.ok(r.ok && r.identity === 'deleted')
  const er = await prisma.pilgrimIdentityErasure.findFirstOrThrow({ where: { actorId: staff.userId, reason: 'staff_detach' }, orderBy: { createdAt: 'desc' } })
  assert.deepEqual([er.cardsDetached, er.revealEvents], [1, 1])
})

await t('KARTU TANPA KUNCI (bayi): saran identitas bernama + bertanggal lahir sama; tautkan → tetap tertaut saat diedit tanpa NIK; kartu bernik ditolak 404', async () => {
  const babyDob = addDays(todayInApp(), -200)
  const g = await makeUser(); const f = await makeUser()
  await card(g, { fullName: 'Aisyah Putri', gender: 'female', birthDate: babyDob, nik: nikOf(50) })
  const baby = await card(f, { fullName: 'Aisyah Putri', gender: 'female', birthDate: babyDob, nik: null })
  const target = (await prisma.savedPilgrim.findFirstOrThrow({ where: { ownerId: g.userId }, select: { identityId: true } })).identityId!
  const list = await listUnmatchedCards(staff, { ...page, q: 'aisyah putri' })
  const item = list!.items.find(i => i.id === baby)
  assert.ok(item); assert.deepEqual(item.suggestions.map(s => s.id), [target])
  assert.ok((await linkUnmatchedCard(staff, baby, target)).ok)
  assert.deepEqual([(await row(baby)).identityId, (await row(baby)).matchStatus], [target, 'matched'])
  await update(f, baby, { fullName: 'Aisyah Putri', gender: 'female', birthDate: babyDob, nik: null, birthPlace: 'Jakarta' })
  assert.equal((await row(baby)).identityId, target, 'tautan petugas bertahan selama tanpa kunci')
  const keyed = await linkUnmatchedCard(staff, cardA, target)
  assert.deepEqual(!keyed.ok && keyed.status, 404)
})

await t('SUMBER: penulis tunggal alias/cocok manual/penanda NIK/pin/jejak hapus; rate limit buka NIK; route buka NIK no-store', () => {
  const hits = execSync(`grep -rlE "pilgrimIdentityAlias\\.(create|update|delete)|pilgrimIdentityErasure\\.create|matchConfirmedAt\\" = |nikCheckRequestedAt\\" = |canonicalPinnedAt: (now|new Date)" app lib components || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).sort()
  assert.deepEqual(hits, ['lib/pilgrims/warehouse.ts'])
  assert.ok(readFileSync('lib/pilgrims/warehouse.ts', 'utf8').includes(`limited('identityRevealStaff'`))
  assert.ok(readFileSync('app/api/v1/admin/identities/[id]/reveal/route.ts', 'utf8').includes(`'Cache-Control', 'no-store'`))
  // Klien tak boleh mencapai gudang (lib/pii lewat rantai impor) — komponen klien halaman gudang hanya memanggil API.
  for (const f of execSync('grep -rl "use client" "app/[locale]/admin/(protected)/identitas-jamaah"', { encoding: 'utf8' }).split('\n').filter(Boolean)) {
    assert.ok(!/from '@\/lib\/(pii|pilgrims\/(warehouse|service))'/.test(readFileSync(f, 'utf8')), f)
  }
})

// ── pembersihan (DB uji) ────────────────────────────────────────────────────────────────────────────────────────────
const ids = (await prisma.savedPilgrim.findMany({ where: { ownerId: { in: users } }, select: { identityId: true } })).flatMap(x => (x.identityId ? [x.identityId] : []))
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
await prisma.savedPilgrim.deleteMany({ where: { ownerId: { in: users } } })
await prisma.pilgrimIdentity.deleteMany({ where: { id: { in: ids } } })
await prisma.pilgrimIdentity.deleteMany({ where: { cards: { none: {} }, bookingPilgrims: { none: {} }, fullName: { in: ['Budi Santoso', 'Budi Santosa', 'Budiman Santoso', 'Siti Aminah', 'John Smith', 'Aisyah Putri', 'Hapus Saja', 'Jejak Tetap'] } } })
await prisma.pilgrimIdentityErasure.deleteMany({ where: { actorId: { in: users } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()

if (failed > 0) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
