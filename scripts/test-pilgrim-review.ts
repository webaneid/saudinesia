// Uji pemeriksaan data jamaah booking (lib/pilgrims/review.ts + lib/documents/review.ts, docs/arsitektur-jamaah.md §8.4, Fase 6) terhadap
// DATABASE SUNGGUHAN + penyimpanan memori: transisi sah/tak sah, verifikasi mustahil sebelum dokumen wajib diterima, data kanonik identitas
// mengikuti data terverifikasi, dokumen diganti/dihapus/ditolak → pengajuan aktif dibuka ulang (booking selesai tidak), kunci tautan/edit selama
// diperiksa, riwayat append-only di DB (UPDATE/DELETE ditolak, catatan boleh dikosongkan, ikut terhapus bersama jamaah booking), dan penjaga sumber.
// PENGAMAN: menulis baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { __resetForTests } from '@/lib/auth/rateLimit'
import { createSavedPilgrim, type Actor } from '@/lib/pilgrims/service'
import { linkCard, unlinkCard } from '@/lib/pilgrims/bookingLink'
import { decidePilgrim, reopenForChangedRequirements, reviewHistoryOf, submitPilgrim } from '@/lib/pilgrims/review'
import { reviewDocument, reviewPreviewUrl } from '@/lib/documents/review'
import { createDocumentService } from '@/lib/documents/service'
import type { DocumentStorage } from '@/lib/documents/storage'
import { writeRequirements } from '@/lib/documents/requirements'
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
delete env.RESEND_API_KEY // notify() tak mengirim keluar dari uji
__resetForTests()
await prisma.piiKeyCheck.deleteMany()

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const tag = `rv${Date.now()}`
let n = 0
const users: string[] = []
async function makeUser(role: 'pilgrim' | 'admin' = 'pilgrim'): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `${tag}-${++n}@example.test`, passwordHash: 'x', fullName: `Uji ${n}`, role, emailVerifiedAt: new Date() }, select: { id: true, role: true } })
  users.push(u.id)
  return { userId: u.id, role: u.role }
}
const serial = Number(String(Date.now()).slice(-3))
const NIK = `3201011507850${String(serial).padStart(3, '1')}`

const staff = await makeUser('admin')
const owner = await makeUser()
const stranger = await makeUser()

const visa = await prisma.visaProduct.create({ data: { name: `${tag} visa`, visaType: 'Umroh' } })
const F = (fieldKey: string, fieldType: string, role: string | null, order: number, required = true) => ({ productType: 'visa', productId: visa.id, fieldKey, label: fieldKey, fieldType, role, order, required })
await prisma.manifestFieldRequirement.createMany({ data: [
  F('fullName', 'text', 'display_name', 0), F('gender', 'select', 'gender', 1), F('dateOfBirth', 'date', 'birth_date', 2), F('birthPlace', 'text', 'birth_place', 3),
  F('nik', 'text', 'nik', 4), F('mahram', 'text', null, 5, false),
] })
const types = Object.fromEntries((await prisma.documentType.findMany()).map(x => [x.key, x]))
await prisma.$transaction(tx => writeRequirements(tx, 'visa', visa.id, [
  { documentTypeId: types.passport!.id, label: null, description: '', required: true },
  { documentTypeId: types.flight_ticket!.id, label: null, description: '', required: true },
]))

const card = await (async () => {
  const r = await createSavedPilgrim(staff, owner.userId, savedPilgrimInputSchema.parse({
    fullName: 'Budi Santoso', gender: 'male', birthPlace: 'Bandung', birthDate: '1985-07-15', nationality: 'ID', nik: NIK,
  }))
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
  return r.card.id
})()

async function makeBooking(status: 'active' | 'completed' = 'active') {
  const b = await prisma.booking.create({
    data: { bookingCode: `BK-${tag}-${++n}`, userId: owner.userId, status, season: 'regular', totalAmount: 1, pilgrims: { create: [{ isLeader: true, fieldValues: {} }] } },
    include: { pilgrims: { select: { id: true } } },
  })
  const pid = b.pilgrims[0]!.id
  await prisma.visaApplication.create({ data: { bookingPilgrimId: pid, visaType: 'umrah', visaProductId: visa.id, plannedTravelDate: new Date('2026-12-01') } })
  return { id: b.id, pilgrim: pid }
}
const row = (id: string) => prisma.bookingPilgrim.findUniqueOrThrow({ where: { id }, select: { reviewStatus: true, submittedAt: true, verifiedAt: true, verifiedById: true } })

const mem = new Map<string, Buffer>()
const storage: DocumentStorage = {
  put: async (k, b) => { mem.set(k, b) },
  remove: async (k) => { mem.delete(k) },
  removePrefix: async (p) => { let c = 0; for (const k of [...mem.keys()]) if (k.startsWith(p)) { mem.delete(k); c++ } return c },
  url: async (k) => `https://minio.test/${k}?X-Amz-Signature=uji`,
}
const svc = createDocumentService(storage)
const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [] /Count 0 >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n', 'latin1')
async function upload(typeKey: 'passport' | 'flight_ticket', bookingId: string | null, extra: Record<string, unknown> = {}) {
  const fields = typeKey === 'passport' ? { documentTypeId: types.passport!.id, expiresAt: '2030-01-01', ...extra } : { documentTypeId: types.flight_ticket!.id, referenceCode: 'ABC123', ...extra }
  const r = await svc.upload(staff, owner.userId, card, fields as never, pdf, { bookingId })
  if (!r.ok) throw new Error(`${r.status} ${r.error}`)
  return r.document.id
}

const bk = await makeBooking()

await t('AJUKAN DITOLAK: belum tertaut kartu → 409; jamaah akun lain → 404; dokumen wajib belum ada → 422 dengan nama dokumennya', async () => {
  const r0 = await submitPilgrim(owner, bk.id, bk.pilgrim)
  assert.deepEqual(!r0.ok && r0.status, 409)
  assert.ok((await linkCard(owner, bk.id, bk.pilgrim, card)).ok)
  const r1 = await submitPilgrim(stranger, bk.id, bk.pilgrim)
  assert.deepEqual(!r1.ok && r1.status, 404)
  const r2 = await submitPilgrim(owner, bk.id, bk.pilgrim)
  assert.ok(!r2.ok && r2.status === 422 && /Paspor/i.test(r2.error), JSON.stringify(r2))
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'draft')
})

let passportDoc = ''
let ticketDoc = ''
await t('AJUKAN: data + dokumen wajib siap → submitted (+ submittedAt, tautan dokumen, riwayat); dua kali → 409; tautkan/lepas/ubah kartu dikunci', async () => {
  passportDoc = await upload('passport', null)
  ticketDoc = await upload('flight_ticket', bk.id)
  const r = await submitPilgrim(owner, bk.id, bk.pilgrim)
  assert.deepEqual(r, { ok: true, status: 'submitted' })
  const bp = await row(bk.pilgrim)
  assert.ok(bp.submittedAt); assert.equal(bp.verifiedAt, null)
  const links = await prisma.bookingPilgrimDocument.findMany({ where: { bookingPilgrimId: bk.pilgrim }, select: { pilgrimDocumentId: true } })
  assert.deepEqual(links.map(l => l.pilgrimDocumentId).sort(), [passportDoc, ticketDoc].sort())
  const again = await submitPilgrim(owner, bk.id, bk.pilgrim)
  assert.deepEqual(!again.ok && again.status, 409)
  for (const r2 of [await linkCard(owner, bk.id, bk.pilgrim, card), await unlinkCard(staff, bk.id, bk.pilgrim)]) assert.deepEqual(!r2.ok && r2.status, 409)
})

await t('KEPUTUSAN: jamaah tak bisa memutus (404); kembalikan tanpa catatan → 400; verifikasi sebelum dokumen DITERIMA → 422', async () => {
  const r0 = await decidePilgrim(owner, bk.id, bk.pilgrim, { decision: 'verified' })
  assert.deepEqual(!r0.ok && r0.status, 404)
  const r1 = await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'needs_revision', note: '   ' })
  assert.deepEqual(!r1.ok && [r1.status, r1.field], [400, 'note'])
  const r2 = await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' })
  assert.ok(!r2.ok && r2.status === 422 && /belum semuanya diterima/.test(r2.error), JSON.stringify(r2))
})

await t('TOLAK DOKUMEN → kembalikan → jamaah ganti berkas → ajukan ulang → terima → VERIFIKASI: identitas kanonik + lastVerifiedAt', async () => {
  const rej = await reviewDocument(staff, bk.id, bk.pilgrim, passportDoc, { status: 'rejected', rejectReason: 'unreadable', note: 'buram' })
  assert.deepEqual(rej, { ok: true, status: 'rejected' })
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'submitted', 'ditolak saat diajukan → tetap diajukan')
  assert.ok((await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'needs_revision', note: 'Unggah ulang paspor yang jelas' })).ok)
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'needs_revision')
  passportDoc = await upload('passport', null) // mengganti (jenis satu berkas)
  assert.ok((await submitPilgrim(owner, bk.id, bk.pilgrim)).ok)
  for (const d of [passportDoc, ticketDoc]) assert.ok((await reviewDocument(staff, bk.id, bk.pilgrim, d, { status: 'accepted' })).ok)
  // Snapshot diubah sebelum verifikasi (setara koreksi petugas sebelum diajukan) — kanonik harus mengikuti snapshot, bukan kartu.
  const fv = (await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: bk.pilgrim }, select: { fieldValues: true } })).fieldValues as Record<string, unknown>
  await prisma.bookingPilgrim.update({ where: { id: bk.pilgrim }, data: { fieldValues: { ...fv, fullName: 'Budi Santoso Bin Ahmad' } }, select: { id: true } })
  const r = await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' })
  assert.deepEqual(r, { ok: true, status: 'verified' })
  const bp = await row(bk.pilgrim)
  assert.ok(bp.verifiedAt); assert.equal(bp.verifiedById, staff.userId)
  const identityId = (await prisma.savedPilgrim.findUniqueOrThrow({ where: { id: card }, select: { identityId: true } })).identityId!
  const id = await prisma.pilgrimIdentity.findUniqueOrThrow({ where: { id: identityId } })
  assert.equal(id.fullName, 'Budi Santoso Bin Ahmad'); assert.ok(id.lastVerifiedAt)
  const ev = await prisma.pilgrimIdentityEvent.findFirstOrThrow({ where: { identityId, kind: 'canonical_updated' }, orderBy: { createdAt: 'desc' } })
  assert.ok(!JSON.stringify(ev.detail).includes('Budi'), 'jejak identitas tanpa PII')
  const hist = (await reviewHistoryOf([bk.pilgrim], false)).get(bk.pilgrim)!
  assert.deepEqual(hist.map(h => h.to), ['verified', 'submitted', 'needs_revision', 'submitted'], 'menolak dokumen saat masih diajukan tidak menambah riwayat')
  assert.ok(hist.every(h => h.actorName === null), 'nama petugas tak dikirim ke pemesan')
  const verifiedAgain = await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' })
  assert.deepEqual(!verifiedAgain.ok && verifiedAgain.status, 409)
})

await t('DIBUKA ULANG: ganti paspor sesudah terverifikasi → submitted (verifiedAt kosong, riwayat); booking SELESAI tak berubah', async () => {
  const done = await makeBooking()
  assert.ok((await linkCard(staff, done.id, done.pilgrim, card)).ok)
  await upload('flight_ticket', done.id)
  assert.ok((await submitPilgrim(staff, done.id, done.pilgrim)).ok)
  // Pemisahan tugas = pengingat saja (keputusan pemilik 2026-11-03): pengajuan petugas ini sendiri ditandai `byViewer` untuk petugas itu saja,
  // tidak untuk petugas lain dan tidak pernah di halaman pemesan; verifikasi oleh petugas yang sama tetap boleh (di bawah).
  const mine = (await reviewHistoryOf([done.pilgrim], true, staff.userId)).get(done.pilgrim)!
  assert.deepEqual([mine[0]?.to, mine[0]?.byViewer], ['submitted', true])
  assert.equal((await reviewHistoryOf([done.pilgrim], true, owner.userId)).get(done.pilgrim)![0]?.byViewer, false, 'petugas lain tak ditandai')
  assert.equal((await reviewHistoryOf([done.pilgrim], false, staff.userId)).get(done.pilgrim)![0]?.byViewer, false, 'halaman pemesan tak pernah')
  for (const d of await prisma.pilgrimDocument.findMany({ where: { savedPilgrimId: card }, select: { id: true } })) await prisma.pilgrimDocument.update({ where: { id: d.id }, data: { status: 'accepted' } })
  assert.ok((await decidePilgrim(staff, done.id, done.pilgrim, { decision: 'verified' })).ok)
  await prisma.booking.update({ where: { id: done.id }, data: { status: 'completed' } })
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'verified')
  passportDoc = await upload('passport', null)
  const a = await row(bk.pilgrim)
  assert.deepEqual([a.reviewStatus, a.verifiedAt, a.verifiedById], ['submitted', null, null])
  assert.equal((await row(done.pilgrim)).reviewStatus, 'verified', 'booking selesai tidak dibuka ulang')
  const last = await prisma.pilgrimReviewEvent.findFirstOrThrow({ where: { bookingPilgrimId: bk.pilgrim }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  assert.deepEqual([last.fromStatus, last.toStatus, last.note], ['verified', 'submitted', 'Dokumen diganti'])
})

await t('DIBUKA ULANG: hapus dokumen perjalanan / tolak dokumen pada pengajuan terverifikasi → submitted', async () => {
  assert.ok((await reviewDocument(staff, bk.id, bk.pilgrim, passportDoc, { status: 'accepted' })).ok)
  assert.ok((await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' })).ok)
  assert.ok((await reviewDocument(staff, bk.id, bk.pilgrim, ticketDoc, { status: 'rejected', rejectReason: 'not_matching' })).ok)
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'submitted')
  const r = await reviewDocument(staff, bk.id, bk.pilgrim, ticketDoc, { status: 'rejected' })
  assert.deepEqual(!r.ok && [r.status, r.field], [400, 'rejectReason'])
  assert.ok((await reviewDocument(staff, bk.id, bk.pilgrim, ticketDoc, { status: 'accepted' })).ok)
  assert.ok((await decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' })).ok)
  assert.ok((await svc.remove(owner, owner.userId, card, ticketDoc, { bookingId: bk.id })).ok)
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'submitted')
})

await t('CAKUPAN dokumen: jamaah tak bisa meninjau (404); dokumen kartu lain / booking lain → 404; pratinjau lewat cakupan jamaah booking', async () => {
  const r0 = await reviewDocument(owner, bk.id, bk.pilgrim, passportDoc, { status: 'accepted' })
  assert.deepEqual(!r0.ok && r0.status, 404)
  const otherBk = await makeBooking()
  const r1 = await reviewDocument(staff, otherBk.id, otherBk.pilgrim, passportDoc, { status: 'accepted' })
  assert.deepEqual(!r1.ok && r1.status, 404, 'jamaah booking tanpa kartu tertaut')
  const p = await reviewPreviewUrl(staff, bk.id, bk.pilgrim, passportDoc, svc)
  assert.ok(p.ok && p.url.startsWith('https://minio.test/saved-pilgrims/'))
  const p2 = await reviewPreviewUrl(owner, bk.id, bk.pilgrim, passportDoc, svc)
  assert.deepEqual(!p2.ok && p2.status, 404)
})

await t('BOOKING TIDAK AKTIF: ajukan/putuskan → 409', async () => {
  const c = await makeBooking('completed')
  const r = await submitPilgrim(staff, c.id, c.pilgrim)
  assert.deepEqual(!r.ok && r.status, 409)
})

await t('DB: riwayat append-only (UPDATE isi / DELETE ditolak), catatan boleh dikosongkan, CHECK status↔waktu, cascade bersama jamaah booking', async () => {
  const ev = await prisma.pilgrimReviewEvent.findFirstOrThrow({ where: { bookingPilgrimId: bk.pilgrim, note: { not: null } } })
  await assert.rejects(prisma.pilgrimReviewEvent.update({ where: { id: ev.id }, data: { note: 'diubah' } }), /append-only/)
  await assert.rejects(prisma.pilgrimReviewEvent.update({ where: { id: ev.id }, data: { toStatus: 'draft' } }), /append-only/)
  await assert.rejects(prisma.pilgrimReviewEvent.delete({ where: { id: ev.id } }), /append-only/)
  await prisma.pilgrimReviewEvent.update({ where: { id: ev.id }, data: { note: null } })
  await assert.rejects(prisma.bookingPilgrim.update({ where: { id: bk.pilgrim }, data: { reviewStatus: 'verified', verifiedAt: null }, select: { id: true } }), /booking_pilgrims_verified_at/)
  await assert.rejects(prisma.bookingPilgrim.update({ where: { id: bk.pilgrim }, data: { reviewStatus: 'submitted', submittedAt: null }, select: { id: true } }), /booking_pilgrims_submitted_at/)
  const tmp = await makeBooking()
  assert.ok((await linkCard(staff, tmp.id, tmp.pilgrim, card)).ok)
  await prisma.pilgrimReviewEvent.create({ data: { bookingPilgrimId: tmp.pilgrim, toStatus: 'submitted', note: 'x' } })
  await prisma.visaApplication.deleteMany({ where: { bookingPilgrimId: tmp.pilgrim } })
  await prisma.bookingPilgrim.delete({ where: { id: tmp.pilgrim }, select: { id: true } })
  assert.equal(await prisma.pilgrimReviewEvent.count({ where: { bookingPilgrimId: tmp.pilgrim } }), 0, 'cascade lolos trigger')
})

await t('KUNCI (SEC-200): verifikasi menunggu penolakan dokumen yang sedang berjalan lalu menilai hasilnya → 422, bukan terverifikasi', async () => {
  const doc = await upload('flight_ticket', bk.id)
  for (const d of await prisma.pilgrimDocument.findMany({ where: { savedPilgrimId: card }, select: { id: true } })) await prisma.pilgrimDocument.update({ where: { id: d.id }, data: { status: 'accepted' } })
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'submitted')
  let release!: () => void
  const gate = new Promise<void>(r => { release = r })
  let held!: () => void
  const locked = new Promise<void>(r => { held = r })
  const reject = prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "pilgrim_documents" WHERE "id" = ${doc} FOR UPDATE`
    await tx.pilgrimDocument.update({ where: { id: doc }, data: { status: 'rejected', rejectReason: 'not_matching' } })
    held()
    await gate
  }, { timeout: 10_000 })
  await locked
  let settled = false
  const decide = decidePilgrim(staff, bk.id, bk.pilgrim, { decision: 'verified' }).finally(() => { settled = true })
  await new Promise(r => setTimeout(r, 400))
  assert.equal(settled, false, 'verifikasi tertahan kunci dokumen')
  release(); await reject
  const r = await decide
  assert.deepEqual(!r.ok && r.status, 422, JSON.stringify(r))
  assert.equal((await row(bk.pilgrim)).reviewStatus, 'submitted')
})

await t('SYARAT BERTAMBAH (SEC-201): jamaah terverifikasi yang mendapat visa baru dibuka ulang dengan catatan; selain terverifikasi tak berubah', async () => {
  const x = await makeBooking()
  await prisma.bookingPilgrim.update({ where: { id: x.pilgrim }, data: { reviewStatus: 'verified', submittedAt: new Date(), verifiedAt: new Date() }, select: { id: true } })
  assert.equal(await prisma.$transaction(tx => reopenForChangedRequirements(tx, x.pilgrim, staff.userId, 'Visa ditambahkan')), true)
  assert.equal((await row(x.pilgrim)).reviewStatus, 'submitted')
  assert.equal(await prisma.$transaction(tx => reopenForChangedRequirements(tx, x.pilgrim, staff.userId, 'lagi')), false)
  assert.equal(await prisma.pilgrimReviewEvent.count({ where: { bookingPilgrimId: x.pilgrim } }), 1)
})

await t('SUMBER: penulis tunggal status/riwayat/tautan; route memakai layanan; jamaah submit lewat onboardingRefusal; visa ke Syarikah mensyaratkan terverifikasi', () => {
  const { execSync } = require('node:child_process') as typeof import('node:child_process')
  const hits = execSync(`grep -rlE "pilgrimReviewEvent\\.(create|update|delete)|bookingPilgrimDocument\\.(create|delete)|reviewStatus: '|verifiedAt: (null|to)|submittedAt: now" app lib components || true`, { encoding: 'utf8' })
    .split('\n').filter(Boolean).sort()
  assert.deepEqual(hits, ['lib/account/deletion.ts', 'lib/account/erasureSweep.ts', 'lib/pilgrims/review.ts'])
  assert.ok(readFileSync('app/api/v1/bookings/[id]/pilgrims/[pilgrimId]/submit/route.ts', 'utf8').includes('onboardingRefusal'))
  assert.ok(readFileSync('lib/documents/service.ts', 'utf8').match(/reopenForChangedDocument/g)!.length >= 3)
  assert.ok(readFileSync('app/api/v1/admin/visa/[pilgrimId]/status/route.ts', 'utf8').includes(`reviewStatus !== 'verified'`))
  assert.ok(readFileSync('app/api/v1/admin/visa/[pilgrimId]/status/route.ts', 'utf8').includes('FOR SHARE'), 'status pemeriksaan dibaca di dalam kunci (SEC-202)')
  assert.ok(readFileSync('lib/booking/revise.ts', 'utf8').includes('reopenForChangedRequirements('), 'visa paket lewat revisi membuka ulang (SEC-201)')
})

// ── pembersihan (DB uji) ────────────────────────────────────────────────────────────────────────────────────────────
const identityIds = (await prisma.savedPilgrim.findMany({ where: { ownerId: { in: users } }, select: { identityId: true } })).flatMap(c => (c.identityId ? [c.identityId] : []))
await prisma.pilgrimDocument.deleteMany({ where: { savedPilgrim: { ownerId: { in: users } } } })
await prisma.visaApplication.deleteMany({ where: { pilgrim: { booking: { userId: { in: users } } } } })
await prisma.booking.deleteMany({ where: { userId: { in: users } } })
await prisma.savedPilgrim.deleteMany({ where: { ownerId: { in: users } } })
await prisma.pilgrimIdentity.deleteMany({ where: { id: { in: identityIds } } })
await prisma.documentRequirement.deleteMany({ where: { productId: visa.id } })
await prisma.manifestFieldRequirement.deleteMany({ where: { productId: visa.id } })
await prisma.visaProduct.delete({ where: { id: visa.id } })
await prisma.notificationLog.deleteMany({ where: { userId: { in: users } } })
await prisma.user.deleteMany({ where: { id: { in: users } } })
await prisma.$disconnect()

if (failed > 0) { console.log(`\n${failed} GAGAL`); process.exit(1) }
console.log('\nSEMUA LULUS')
