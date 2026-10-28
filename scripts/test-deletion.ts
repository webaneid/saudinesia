// Uji penghapusan akun UU PDP (SEC-44, docs/arsitektur-hapus-akun.md) terhadap DATABASE SUNGGUHAN + penyimpanan & email PALSU.
// Inti: data pribadi benar-benar hilang/teranonimkan, data yang wajib dipertahankan tetap ada, akun lain tak tersentuh,
// sesi mati, dan setiap penolakan (blocker, konfirmasi, state) terbukti dengan kontrol positif di sampingnya.
//
// PENGAMAN: menulis banyak baris → assertThrowawayDb() menolak jalan kecuali database uji lokal.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compare, hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { sweepErasedAccount, sweepRecentErasures } from '@/lib/account/erasureSweep'
import { deleteObjectsByPrefix } from '@/lib/storage/minio'
import { MIN_WAIT_HOURS, executeDeletion, previewDeletion, rejectDeletion, submitDeletionRequest, withdrawDeletionRequest, type DeletionDeps } from '@/lib/account/deletion'
import { issueSessionToken, resolveSessionToken } from '@/lib/auth/session'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`)
  }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'
env.JWT_SECRET = randomBytes(32).toString('hex')

const tag = `dl${Date.now()}`
let n = 0
const uniq = () => `${tag}-${++n}`
const digits = () => `62${Math.floor(8e9 + Math.random() * 1e9)}`
const ORIGINAL_PASSWORD = 'Sandi-Asli-123!'

// ── Penyimpanan & email palsu ──
function fakeDeps(opts: { failKeys?: boolean } = {}) {
  const deleted: string[] = []
  const prefixes: string[] = []
  const mails: { to: string; subject: string; text: string }[] = []
  let failing = opts.failKeys ?? false
  const deps: DeletionDeps = {
    deleteObject: async (key) => { if (failing) throw new Error('minio down'); deleted.push(key) },
    deleteByPrefix: async (prefix) => { prefixes.push(prefix); return 0 },
    sendEmail: async (i) => { mails.push({ to: i.to, subject: i.subject, text: i.text }); return { status: 'sent', id: 'x' } },
  }
  return { deps, deleted, prefixes, mails, setFailing: (v: boolean) => { failing = v } }
}

type Seeded = {
  userId: string; email: string; number: string; googleSub: string; addressId: string
  bookingId: string; pilgrimId: string; docKeys: string[]; requestId: string
  paymentId: string; refundId: string; adjustmentId: string; costActualId: string; vendorCostId: string; transportId: string; consentIds: string[]; groupMemberId: string; crossPilgrimId: string
}

const createdUsers: string[] = []
let transportQuotaId: string | null = null
const chain: { trip?: string; vehicle?: string; pricing?: string } = {}
async function quota(): Promise<string> {
  if (transportQuotaId) return transportQuotaId
  const trip = await prisma.transportTrip.create({ data: { name: `Trip ${tag}`, origin: 'A', destination: 'B' } })
  const vehicle = await prisma.transportVehicle.create({ data: { name: `Bus ${tag}`, vehicleType: 'bus', capacity: 40 } })
  const pricing = await prisma.transportPricing.create({ data: { tripId: trip.id, vehicleId: vehicle.id } })
  const q = await prisma.transportQuota.create({ data: { pricingId: pricing.id, travelDate: new Date('2026-01-10'), totalSeats: 100 } })
  Object.assign(chain, { trip: trip.id, vehicle: vehicle.id, pricing: pricing.id })
  return (transportQuotaId = q.id)
}

async function seed(opts: { bookingStatus?: 'completed' | 'cancelled' | 'active' | 'awaiting_payment'; refundStatus?: 'paid' | 'pending'; role?: 'pilgrim' | 'admin'; freshRequest?: boolean } = {}): Promise<Seeded> {
  const email = `${uniq()}@example.test`
  const number = digits()
  const googleSub = `gsub-${uniq()}`
  const address = await prisma.address.create({ data: { type: 'domestic', fullAddress: 'Jl. Rahasia No. 7 RT 01/02', postalCode: '12345' } })
  const user = await prisma.user.create({
    data: {
      email, passwordHash: await hash(ORIGINAL_PASSWORD, 4), fullName: 'Budi Santoso',
      phone: number, whatsapp: number, whatsappVerifiedAt: new Date(), verifiedWhatsapp: number, googleSub,
      role: opts.role ?? 'pilgrim', isActive: true, emailVerifiedAt: new Date(), addressId: address.id,
      consentLogs: { create: [{ type: 'privacy_policy', version: 'v1' }, { type: 'whatsapp_notifications', version: 'v1' }] },
    },
    include: { consentLogs: true },
  })
  createdUsers.push(user.id)

  const booking = await prisma.booking.create({
    data: {
      bookingCode: `BK-${uniq()}`, userId: user.id, status: opts.bookingStatus ?? 'completed',
      departureDate: new Date('2026-01-10'), returnDate: new Date('2026-01-20'), season: 'regular', totalAmount: new Decimal(12_500_000), notes: 'Catatan: istri sakit, nomor 0812-RAHASIA',
      pilgrims: { create: [{ isLeader: true, userId: user.id, fieldValues: { fullName: 'Budi Santoso', passportNumber: 'X1234567', dateOfBirth: '1980-01-01' } }] },
    },
    include: { pilgrims: true },
  })
  const pilgrim = booking.pilgrims[0]!
  const docKeys = [`pilgrims/${pilgrim.id}/passport/${uniq()}-scan.pdf`, `pilgrims/${pilgrim.id}/ktp/${uniq()}-ktp.jpg`]
  for (const k of docKeys) await prisma.document.create({ data: { bookingPilgrimId: pilgrim.id, docType: 'passport', fileName: 'scan.pdf', filePath: k } })
  await prisma.visaApplication.create({ data: { bookingPilgrimId: pilgrim.id, visaType: 'umrah', notes: 'paspor kedua atas nama istri', rejectionReason: 'foto buram, hubungi 0812-RAHASIA' } })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: new Decimal(12_500_000), method: 'transfer', status: 'confirmed', buktiTransferPath: `payments/${uniq()}/bukti.jpg`, notes: 'nama pengirim beda: Ahmad 0812-RAHASIA' } })
  const refund = await prisma.refund.create({ data: { bookingId: booking.id, amount: new Decimal(500_000), reason: 'selisih', notes: 'transfer ke rekening istri BCA 123456', status: opts.refundStatus ?? 'paid' } })
  // Fase 7: catatan staf yang menyebut nama pemesan (penyesuaian total + pengeluaran vendor) harus dibersihkan saat akun dihapus
  const adjustment = await prisma.bookingAdjustment.create({ data: { bookingId: booking.id, amountIdr: new Decimal(-100_000), label: 'Diskon', reason: 'nego dengan Budi Santoso 0812-RAHASIA', totalBefore: new Decimal(12_600_000), totalAfter: new Decimal(12_500_000), costKnownIdr: new Decimal(0), belowCost: false, byUserId: 'staf-uji' } })
  const vendorForCost = await prisma.vendor.create({ data: { name: `Vendor Hapus ${uniq()}`, nameKey: `vendor hapus ${uniq()}`, countryCode: 'SA' } })
  const costActual = await prisma.costActual.create({ data: { bookingId: booking.id, vendorId: vendorForCost.id, component: 'k', currency: 'IDR', amount: new Decimal(1000), amountIdr: new Decimal(1000), paidAt: new Date('2026-01-05'), varianceNote: 'dibayar tunai oleh Budi Santoso', voidReason: 'salah input — Budi', voidedAt: new Date(), voidedBy: 'staf-uji', recordedBy: 'staf-uji' } })
  const transport = await prisma.bookingTransport.create({ data: { bookingId: booking.id, transportQuotaId: await quota(), travelDate: new Date('2026-01-10'), unitPrice: new Decimal(100), totalPrice: new Decimal(100), pickupDetail: 'Hotel Anjung kamar 1204, tel 0812-RAHASIA', dropoffDetail: 'Rumah Pak Haji' } })

  await prisma.notificationLog.createMany({ data: [
    { userId: user.id, bookingId: booking.id, channel: 'email', type: 'booking_submitted', recipient: email, messagePreview: 'Halo Budi, booking Anda…', status: 'sent', error: `gagal ke ${email}` },
    { userId: user.id, channel: 'whatsapp', type: 'payment_reminder', recipient: number, messagePreview: 'Pengingat bayar', status: 'sent' },
  ] })
  await prisma.authToken.create({ data: { type: 'password_reset', tokenHash: `h-${uniq()}`, userId: user.id, expiresAt: new Date(Date.now() + 3_600_000) } })
  await prisma.authToken.create({ data: { type: 'registration', tokenHash: `h-${uniq()}`, email, payload: { fullName: 'Budi Santoso', phone: number }, expiresAt: new Date(Date.now() + 3_600_000) } })

  const group = await prisma.group.create({ data: { groupCode: `GR-${uniq()}`, leaderUserId: user.id, totalMembers: 2 } })
  const member = await prisma.groupMember.create({ data: { groupId: group.id, userId: user.id, inviteToken: `inv-${uniq()}`, status: 'accepted' } })

  // Manifest di booking ORANG LAIN yang menautkan akun ini (isi manifest itu milik pemesannya, bukan akun yang dihapus).
  const other = await prisma.user.create({ data: { email: `${uniq()}@example.test`, passwordHash: 'x', fullName: 'Pemesan Lain', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  createdUsers.push(other.id)
  const otherBooking = await prisma.booking.create({
    data: {
      bookingCode: `BK-${uniq()}`, userId: other.id, status: 'completed', departureDate: new Date('2026-02-10'), returnDate: new Date('2026-02-20'), season: 'regular', totalAmount: new Decimal(1),
      pilgrims: { create: [{ userId: user.id, fieldValues: { fullName: 'Keluarga di booking lain' } }] },
    },
    include: { pilgrims: true },
  })

  const request = await prisma.accountDeletionRequest.create({ data: { userId: user.id, requestedAt: new Date(Date.now() - (opts.freshRequest ? 1 : MIN_WAIT_HOURS + 28) * 3_600_000) } })
  return {
    userId: user.id, email, number, googleSub, addressId: address.id, bookingId: booking.id, pilgrimId: pilgrim.id, docKeys, requestId: request.id,
    paymentId: payment.id, refundId: refund.id, adjustmentId: adjustment.id, costActualId: costActual.id, vendorCostId: vendorForCost.id, transportId: transport.id, consentIds: user.consentLogs.map((c) => c.id), groupMemberId: member.id, crossPilgrimId: otherBooking.pilgrims[0]!.id,
  }
}

const Decimal = Prisma.Decimal
const admin = await prisma.user.create({ data: { email: `${uniq()}@example.test`, passwordHash: 'x', fullName: 'Superadmin Uji', role: 'superadmin', isActive: true, emailVerifiedAt: new Date() } })
createdUsers.push(admin.id)

console.log('== pratinjau & syarat ==')

await t('pratinjau: jamaah dengan booking selesai → layak, jumlah yang akan dihapus akurat', async () => {
  const s = await seed()
  const p = await previewDeletion(s.requestId)
  assert.equal(p.kind, 'ok'); if (p.kind !== 'ok') return
  assert.equal(p.eligible, true); assert.deepEqual(p.blockers, [])
  assert.deepEqual(p.willErase, { bookings: 1, pilgrims: 1, documents: 2, visaApplications: 1, notifications: 2, authTokens: 1, groupMemberships: 1, address: 1 })
})

await t('blocker: booking masih berjalan (tiap status non-terminal) menolak; kontrol positif: completed/cancelled lolos', async () => {
  for (const status of ['active', 'awaiting_payment'] as const) {
    const s = await seed({ bookingStatus: status }); const f = fakeDeps()
    const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)
    assert.equal(r.ok, false); assert.equal(!r.ok && r.reason, 'blocked'); assert.match(!r.ok && r.reason === 'blocked' ? r.blockers.join() : '', /booking masih berjalan/)
    assert.equal(f.deleted.length, 0, 'berkas tak boleh disentuh bila ditolak')
    assert.equal((await prisma.user.findUnique({ where: { id: s.userId } }))?.email, s.email, 'akun tak berubah')
    assert.equal((await prisma.user.findUnique({ where: { id: s.userId } }))?.isActive, true, 'isActive tak boleh tertinggal false setelah penolakan (rollback)')
  }
  for (const status of ['completed', 'cancelled'] as const) {
    const s = await seed({ bookingStatus: status })
    assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)).ok, true, status)
  }
})

await t('blocker: refund pending menolak; kontrol positif refund paid lolos', async () => {
  const s = await seed({ refundStatus: 'pending' })
  const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  assert.equal(!r.ok && r.reason, 'blocked'); assert.match(!r.ok && r.reason === 'blocked' ? r.blockers.join() : '', /refund/)
  await prisma.refund.update({ where: { id: s.refundId }, data: { status: 'paid' } })
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)).ok, true)
})

await t('blocker: akun staf (bukan jamaah) ditolak lewat jalur UU PDP', async () => {
  const s = await seed({ role: 'admin' })
  const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  assert.equal(!r.ok && r.reason, 'blocked'); assert.match(!r.ok && r.reason === 'blocked' ? r.blockers.join() : '', /bukan jamaah/)
  assert.equal((await prisma.user.findUnique({ where: { id: s.userId } }))?.email, s.email)
})

await t('konfirmasi email: salah → ditolak tanpa menyentuh apa pun; benar (huruf besar/spasi diabaikan) → lolos', async () => {
  const s = await seed(); const f = fakeDeps()
  for (const bad of ['salah@example.test', '', s.email.slice(0, -1)]) {
    const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: bad }, f.deps)
    assert.equal(!r.ok && r.reason, 'confirm_mismatch', bad)
  }
  assert.equal(f.deleted.length, 0)
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: `  ${s.email.toUpperCase()} ` }, f.deps)).ok, true)
})

console.log('== penghapusan ==')

await t('anonimisasi lengkap: tiap kolom PII hilang / diacak; ringkasan tercatat', async () => {
  const s = await seed(); const f = fakeDeps()
  const r = await executeDeletion(s.requestId, admin.id, { note: 'sesuai permintaan', confirmEmail: s.email }, f.deps)
  assert.equal(r.ok, true)
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })
  assert.equal(u.email, `deleted-${s.userId}@deleted.invalid`)
  assert.equal(u.fullName, 'Akun Dihapus')
  for (const k of ['phone', 'whatsapp', 'whatsappVerifiedAt', 'verifiedWhatsapp', 'googleSub', 'addressId'] as const) assert.equal(u[k], null, k)
  assert.equal(u.isActive, false)
  assert.equal(await prisma.address.findUnique({ where: { id: s.addressId } }), null, 'alamat rumah dihapus')
  // manifest & dokumen
  const p = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: s.pilgrimId } })
  assert.deepEqual(p.fieldValues, {}); assert.equal(p.userId, null)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 0)
  assert.deepEqual([...f.deleted].sort(), [...s.docKeys].sort(), 'tepat berkas milik jamaah yang dihapus dari penyimpanan')
  // teks bebas
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })).notes, null)
  const v = await prisma.visaApplication.findUniqueOrThrow({ where: { bookingPilgrimId: s.pilgrimId } })
  assert.equal(v.notes, null); assert.equal(v.rejectionReason, null)
  // teks bebas pada baris yang dipertahankan (DEL-01)
  const tr = await prisma.bookingTransport.findUniqueOrThrow({ where: { id: s.transportId } })
  assert.equal(tr.pickupDetail, null); assert.equal(tr.dropoffDetail, null)
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).notes, null)
  assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: s.refundId } })).notes, null)
  const adj = await prisma.bookingAdjustment.findUniqueOrThrow({ where: { id: s.adjustmentId } })
  assert.deepEqual([adj.reason, adj.label, Number(adj.amountIdr)], ['[dihapus]', 'Diskon', -100_000], 'catatan staf dibersihkan; angka dan label (invoice) tetap')
  const ca = await prisma.costActual.findUniqueOrThrow({ where: { id: s.costActualId } })
  assert.deepEqual([ca.varianceNote, ca.voidReason, ca.component, Number(ca.amountIdr)], ['[dihapus]', '[dihapus]', '[dihapus]', 1000])
  // log notifikasi: baris tetap, PII tidak
  const logs = await prisma.notificationLog.findMany({ where: { userId: s.userId } })
  assert.equal(logs.length, 2)
  for (const l of logs) { assert.equal(l.recipient, '[dihapus]'); assert.equal(l.messagePreview, null); assert.equal(l.error, null) }
  // token & grup
  assert.equal(await prisma.authToken.count({ where: { OR: [{ userId: s.userId }, { email: s.email }] } }), 0)
  const gm = await prisma.groupMember.findUniqueOrThrow({ where: { id: s.groupMemberId } })
  assert.equal(gm.userId, null); assert.equal(gm.inviteToken, null)
  // permintaan: selesai + ringkasan tanpa PII
  const req = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: s.requestId } })
  assert.equal(req.status, 'completed'); assert.equal(req.processedById, admin.id); assert.equal(req.note, 'sesuai permintaan'); assert.ok(req.processedAt)
  assert.deepEqual(req.erasureSummary, { bookings: 1, pilgrims: 1, documents: 2, visaApplications: 1, notifications: 2, authTokens: 1, groupMemberships: 1, address: 1 })
  assert.doesNotMatch(JSON.stringify(req), new RegExp(s.email.split('@')[0]!), 'email asli tak boleh muncul di catatan permintaan')
})

await t('data yang WAJIB bertahan: Booking/Payment/Refund (angka & kode), ConsentLog, permintaan', async () => {
  const s = await seed(); await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: s.bookingId } })
  assert.equal(b.userId, s.userId); assert.equal(Number(b.totalAmount), 12_500_000); assert.ok(b.bookingCode.startsWith('BK-'))
  assert.equal(Number((await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).amount), 12_500_000)
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: s.paymentId } })).status, 'confirmed')
  assert.equal(Number((await prisma.refund.findUniqueOrThrow({ where: { id: s.refundId } })).amount), 500_000)
  assert.equal(Number((await prisma.bookingTransport.findUniqueOrThrow({ where: { id: s.transportId } })).totalPrice), 100, 'harga transport (angka) tetap')
  assert.equal(await prisma.consentLog.count({ where: { id: { in: s.consentIds } } }), 2, 'bukti persetujuan dipertahankan')
  assert.equal(await prisma.visaApplication.count({ where: { bookingPilgrimId: s.pilgrimId } }), 1, 'baris visa (status/harga) tetap')
})

await t('manifest di booking ORANG LAIN: tautan akun diputus, isinya TIDAK diubah (milik pemesannya)', async () => {
  const s = await seed(); await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  const p = await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: s.crossPilgrimId } })
  assert.equal(p.userId, null); assert.deepEqual(p.fieldValues, { fullName: 'Keluarga di booking lain' })
})

await t('akun LAIN tak tersentuh (kontrol): data pengguna kedua utuh seluruhnya', async () => {
  const keep = await seed(); const gone = await seed()
  await executeDeletion(gone.requestId, admin.id, { confirmEmail: gone.email }, fakeDeps().deps)
  const u = await prisma.user.findUniqueOrThrow({ where: { id: keep.userId } })
  assert.equal(u.email, keep.email); assert.equal(u.fullName, 'Budi Santoso'); assert.equal(u.verifiedWhatsapp, keep.number); assert.equal(u.isActive, true); assert.ok(u.addressId)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: keep.pilgrimId } }), 2)
  assert.notDeepEqual((await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: keep.pilgrimId } })).fieldValues, {})
  assert.equal((await prisma.notificationLog.findMany({ where: { userId: keep.userId } })).every((l) => l.recipient !== '[dihapus]'), true)
  assert.equal(await prisma.authToken.count({ where: { userId: keep.userId } }), 1)
  assert.equal((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: keep.requestId } })).status, 'pending')
})

await t('sesi lama mati seketika; login mustahil (password acak tak bisa ditebak, isActive=false)', async () => {
  const s = await seed(); const tok = await issueSessionToken(s.userId)
  assert.ok(await resolveSessionToken(tok), 'kontrol positif: sesi hidup sebelum dihapus')
  await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  assert.equal(await resolveSessionToken(tok), null)
  await assert.rejects(issueSessionToken(s.userId))
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })
  assert.equal(await compare(ORIGINAL_PASSWORD, u.passwordHash), false)
  assert.equal(await compare('', u.passwordHash), false)
})

await t('sumber daya dibebaskan: email, nomor WhatsApp terverifikasi, dan googleSub bisa dipakai akun baru', async () => {
  const s = await seed(); await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, fakeDeps().deps)
  const fresh = await prisma.user.create({
    data: { email: s.email, passwordHash: 'x', fullName: 'Pemilik Baru', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), verifiedWhatsapp: s.number, whatsappVerifiedAt: new Date(), googleSub: s.googleSub },
  })
  createdUsers.push(fresh.id)
  assert.equal(fresh.email, s.email)
})

await t('email konfirmasi dikirim ke alamat ASLI setelah commit, tanpa memuat PII lain; alamat tak tersimpan di DB', async () => {
  const s = await seed(); const f = fakeDeps()
  await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)
  assert.equal(f.mails.length, 1); assert.equal(f.mails[0]?.to, s.email); assert.match(f.mails[0]?.subject ?? '', /telah dihapus/)
  assert.doesNotMatch(f.mails[0]?.text ?? '', /X1234567|0812|1980/)
})

console.log('== ketahanan ==')

await t('penyimpanan gagal → DB TIDAK berubah, permintaan tetap pending, tak ada email; coba lagi sesudah pulih → berhasil', async () => {
  const s = await seed(); const f = fakeDeps({ failKeys: true })
  const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)
  assert.equal(!r.ok && r.reason, 'storage_failed')
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })
  assert.equal(u.email, s.email); assert.equal(u.isActive, true)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 2)
  assert.equal((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status, 'pending')
  assert.equal(f.mails.length, 0)
  f.setFailing(false)
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true)
})

await t('state machine: diproses dua kali → kedua kalinya not_pending; completed tak bisa ditolak; rejected tak bisa dihapus', async () => {
  const a = await seed(); const f = fakeDeps()
  assert.equal((await executeDeletion(a.requestId, admin.id, { confirmEmail: a.email }, f.deps)).ok, true)
  assert.equal((await executeDeletion(a.requestId, admin.id, { confirmEmail: a.email }, f.deps)).ok, false)
  const again = await rejectDeletion(a.requestId, admin.id, 'terlambat', f.deps)
  assert.deepEqual(again, { ok: false, reason: 'not_pending' })
  assert.equal(f.mails.length, 1, 'tidak ada email ganda')
  const b = await seed()
  assert.deepEqual(await rejectDeletion(b.requestId, admin.id, 'ada tunggakan', f.deps), { ok: true })
  const r = await executeDeletion(b.requestId, admin.id, { confirmEmail: b.email }, f.deps)
  assert.equal(!r.ok && r.reason, 'not_pending')
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.userId } })).email, b.email, 'ditolak = akun utuh')
  assert.deepEqual(await rejectDeletion('00000000-0000-0000-0000-000000000000', admin.id, null, f.deps), { ok: false, reason: 'not_found' })
  assert.equal((await executeDeletion('00000000-0000-0000-0000-000000000000', admin.id, { confirmEmail: 'x@y.z' }, f.deps)).ok, false)
})

await t('penolakan: email berisi catatan admin; akun tetap aktif dan bisa login', async () => {
  const s = await seed(); const f = fakeDeps()
  await rejectDeletion(s.requestId, admin.id, 'Masih ada refund berjalan', f.deps)
  assert.equal(f.mails.length, 1); assert.match(f.mails[0]?.text ?? '', /Masih ada refund berjalan/)
  const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })
  assert.equal(u.isActive, true); assert.equal(await compare(ORIGINAL_PASSWORD, u.passwordHash), true)
})

await t('balapan: dua superadmin memproses permintaan yang sama bersamaan → tepat satu berhasil, satu email', async () => {
  const s = await seed(); const f = fakeDeps()
  const results = await Promise.all([
    executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps),
    executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps),
  ])
  assert.equal(results.filter((r) => r.ok).length, 1)
  assert.equal(f.mails.length, 1)
  assert.equal(results.find((r) => !r.ok) && (results.find((r) => !r.ok) as { reason: string }).reason, 'not_pending')
})

await t('masa tunggu (DEL-02): permintaan baru tak bisa dihapus (blocker); penolakan tetap boleh; sesudah masa tunggu lolos', async () => {
  const s = await seed({ freshRequest: true }); const f = fakeDeps()
  const pre = await previewDeletion(s.requestId)
  assert.equal(pre.kind === 'ok' && pre.eligible, false); assert.match(pre.kind === 'ok' ? pre.blockers.join() : '', /Masa tunggu/)
  const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)
  assert.equal(!r.ok && r.reason, 'blocked'); assert.equal(f.deleted.length, 0)
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })).isActive, true)
  await prisma.accountDeletionRequest.update({ where: { id: s.requestId }, data: { requestedAt: new Date(Date.now() - (MIN_WAIT_HOURS + 1) * 3_600_000) } })
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true, 'kontrol positif: lewat masa tunggu')
  const s2 = await seed({ freshRequest: true })
  assert.deepEqual(await rejectDeletion(s2.requestId, admin.id, 'tes', fakeDeps().deps), { ok: true }, 'penolakan tak menunggu')
})

await t('pengajuan (DEL-06/DEL-02): dua pengajuan paralel → tepat satu pending; email ke pemilik saat pengajuan', async () => {
  const email = `${uniq()}@example.test`
  const u = await prisma.user.create({ data: { email, passwordHash: 'x', fullName: 'Pemohon', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
  createdUsers.push(u.id)
  const f = fakeDeps()
  const rs = await Promise.all([submitDeletionRequest(u.id, f.deps), submitDeletionRequest(u.id, f.deps), submitDeletionRequest(u.id, f.deps)])
  assert.equal(rs.filter((r) => r.ok).length, 1)
  assert.equal(rs.filter((r) => !r.ok && r.reason === 'pending_exists').length, 2)
  assert.equal(await prisma.accountDeletionRequest.count({ where: { userId: u.id, status: 'pending' } }), 1)
  assert.equal(f.mails.length, 1); assert.equal(f.mails[0]?.to, email); assert.match(f.mails[0]?.subject ?? '', /menerima permintaan hapus akun/)
  assert.match(f.mails[0]?.text ?? '', /72 jam/)
  assert.deepEqual(await submitDeletionRequest('00000000-0000-0000-0000-000000000000', f.deps), { ok: false, reason: 'gone' })
})

await t('penarikan: pending → withdrawn (sekali); permintaan selesai tak bisa ditarik; sesudah ditarik boleh mengajukan lagi', async () => {
  const s = await seed(); const f = fakeDeps()
  assert.equal(await withdrawDeletionRequest(s.userId), true)
  assert.equal((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status, 'withdrawn')
  assert.equal(await withdrawDeletionRequest(s.userId), false, 'tak ada pending')
  const r = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)
  assert.equal(!r.ok && r.reason, 'not_pending', 'permintaan yang ditarik tak bisa dieksekusi'); assert.equal(f.deleted.length, 0)
  assert.equal((await submitDeletionRequest(s.userId, f.deps)).ok, true)
  const done = await seed(); await executeDeletion(done.requestId, admin.id, { confirmEmail: done.email }, f.deps)
  assert.equal(await withdrawDeletionRequest(done.userId), false, 'yang sudah selesai tak bisa ditarik')
})

await t('balapan (DEL-03): tolak/tarik vs eksekusi bersamaan → tepat satu menang; bila penolakan/penarikan menang, TIDAK ADA berkas terhapus dan akun utuh', async () => {
  for (let i = 0; i < 4; i++) {
    const s = await seed(); const f = fakeDeps()
    const [exec, other] = await Promise.all([
      executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps),
      i % 2 === 0 ? rejectDeletion(s.requestId, admin.id, 'x', f.deps).then((r) => r.ok) : withdrawDeletionRequest(s.userId),
    ])
    assert.equal(exec.ok !== other, true, `iterasi ${i}: tepat satu menang (exec=${exec.ok}, other=${other})`)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: s.userId } })
    if (!exec.ok) {
      assert.equal(f.deleted.length, 0, 'berkas tak boleh terhapus bila eksekusi kalah'); assert.equal(u.email, s.email); assert.equal(u.isActive, true)
      assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 2)
    } else {
      assert.equal(u.email, `deleted-${s.userId}@deleted.invalid`)
    }
  }
})

await t('DEL-03 deterministik: penolakan dipicu TEPAT saat berkas sedang dihapus → menunggu kunci, eksekusi selesai utuh, penolakan not_pending (bukan menimpa)', async () => {
  const s = await seed(); const f = fakeDeps()
  let rejection: Promise<{ ok: boolean }> | null = null
  const deps: DeletionDeps = {
    sendEmail: f.deps.sendEmail,
    deleteByPrefix: f.deps.deleteByPrefix,
    deleteObject: async (key) => {
      rejection ??= rejectDeletion(s.requestId, admin.id, 'menyelip', f.deps) // dijalankan di dalam transaksi eksekusi
      await new Promise((r) => setTimeout(r, 400)) // beri waktu penolakan menembus bila TIDAK ada kunci
      f.deleted.push(key)
    },
  }
  const exec = await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, deps)
  assert.equal(exec.ok, true)
  const rej = await rejection!
  assert.equal(rej.ok, false, 'penolakan tidak boleh menang di tengah eksekusi')
  const req = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: s.requestId } })
  assert.equal(req.status, 'completed'); assert.equal(req.note, null, 'catatan penolakan tidak boleh menimpa')
})

await t('permintaan pending ke-2 pada akun yang SUDAH dianonimkan → not_pending, tanpa email ke alamat .invalid', async () => {
  const s = await seed(); const f = fakeDeps()
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true)
  const dup = await prisma.accountDeletionRequest.create({ data: { userId: s.userId, requestedAt: new Date(Date.now() - 200 * 3_600_000) } })
  const r = await executeDeletion(dup.id, admin.id, { confirmEmail: `deleted-${s.userId}@deleted.invalid` }, f.deps)
  assert.equal(!r.ok && r.reason, 'not_pending'); assert.equal(f.mails.length, 1)
})

console.log('== penyapuan tulis terlambat (SEC-57) ==')

/** Menyuntikkan tulis TERLAMBAT pada akun yang sudah dianonimkan: baris dokumen, manifest berisi PII, dan log notifikasi dengan penerima asli. */
async function injectLateWrites(s: Seeded, email: string) {
  await prisma.document.create({ data: { bookingPilgrimId: s.pilgrimId, docType: 'passport', fileName: 'terlambat.pdf', filePath: `pilgrims/${s.pilgrimId}/passport/terlambat.pdf` } })
  await prisma.bookingPilgrim.update({ where: { id: s.pilgrimId }, data: { fieldValues: { fullName: 'Muncul Lagi', passportNumber: 'LATE999' } } })
  await prisma.notificationLog.create({ data: { userId: s.userId, channel: 'email', type: 'booking_submitted', recipient: email, messagePreview: 'isi asli', status: 'sent' } })
}

await t('penyapuan: tulis terlambat (dokumen, manifest, log dengan penerima asli) dibersihkan; awalan objek per jamaah diminta', async () => {
  const s = await seed(); const f = fakeDeps()
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true)
  assert.ok(f.prefixes.includes(`pilgrims/${s.pilgrimId}/`), 'sapuan segera sesudah commit meminta awalan jamaah')
  await injectLateWrites(s, s.email)
  const r = await sweepErasedAccount(s.userId, { deleteByPrefix: f.deps.deleteByPrefix })
  assert.ok(r, 'akun terhapus harus disapu')
  assert.equal(r!.documents, 1); assert.equal(r!.notificationLogs, 1); assert.equal(r!.prefixes, 1)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 0)
  assert.deepEqual((await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: s.pilgrimId } })).fieldValues, {})
  for (const l of await prisma.notificationLog.findMany({ where: { userId: s.userId } })) { assert.equal(l.recipient, '[dihapus]'); assert.equal(l.messagePreview, null) }
})

await t('penyapuan KONSERVATIF: akun hidup, atau berformat terhapus tanpa permintaan completed → null, tidak ada yang disentuh (kontrol positif di atas)', async () => {
  const live = await seed(); const f = fakeDeps()
  await injectLateWrites(live, live.email) // data yang SAH pada akun hidup — tidak boleh tersapu
  assert.equal(await sweepErasedAccount(live.userId, { deleteByPrefix: f.deps.deleteByPrefix }), null)
  assert.equal(f.prefixes.length, 0, 'tidak ada panggilan penyimpanan untuk akun hidup')
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: live.pilgrimId } }), 3)
  assert.notDeepEqual((await prisma.bookingPilgrim.findUniqueOrThrow({ where: { id: live.pilgrimId } })).fieldValues, {})
  // berformat email terhapus tetapi TANPA permintaan selesai (mis. manipulasi manual) → tetap ditolak
  const fake = await seed()
  await prisma.user.update({ where: { id: fake.userId }, data: { email: `deleted-${fake.userId}@deleted.invalid` } })
  assert.equal(await sweepErasedAccount(fake.userId, { deleteByPrefix: f.deps.deleteByPrefix }), null)
  assert.equal(await sweepErasedAccount('00000000-0000-0000-0000-000000000000', { deleteByPrefix: f.deps.deleteByPrefix }), null)
  assert.equal(f.prefixes.length, 0)
})

await t('sweepRecentErasures: hanya completed dalam jendela; terlalu lama / pending / ditolak diabaikan; satu akun gagal tak menghentikan yang lain', async () => {
  const mkErased = async () => {
    const s = await seed(); const f = fakeDeps()
    assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true)
    await injectLateWrites(s, s.email)
    return s
  }
  const recent = await mkErased()
  const old = await mkErased(); await prisma.accountDeletionRequest.update({ where: { id: old.requestId }, data: { processedAt: new Date(Date.now() - 30 * 24 * 3_600_000) } })
  const flaky = await mkErased()
  const pending = await seed()
  const seen: string[] = []
  const deps = { deleteByPrefix: async (prefix: string) => { seen.push(prefix); if (prefix.includes(flaky.pilgrimId)) throw new Error('minio mati'); return 0 } }
  const origErr = console.error; console.error = () => {}
  let sum: Awaited<ReturnType<typeof sweepRecentErasures>>
  try { sum = await sweepRecentErasures(7, deps) } finally { console.error = origErr }
  assert.ok(seen.includes(`pilgrims/${recent.pilgrimId}/`), 'akun baru disapu')
  assert.ok(!seen.includes(`pilgrims/${old.pilgrimId}/`), 'akun di luar jendela diabaikan'); assert.ok(!seen.includes(`pilgrims/${pending.pilgrimId}/`), 'pending diabaikan')
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: recent.pilgrimId } }), 0)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: old.pilgrimId } }), 1, 'di luar jendela: tak disentuh')
  assert.ok(sum.failed >= 1, 'kegagalan dihitung'); assert.ok(sum.accounts >= 1, 'yang lain tetap diproses')
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: flaky.pilgrimId } }), 1, 'akun yang gagal tak setengah-tersapu menghapus baris tanpa objek')
})

await t('S57-LOW1: kegagalan PARSIAL removeObjects dilempar (bukan dilaporkan sukses) tanpa membocorkan nama kunci; semua berhasil → jumlah; daftar kosong → 0', async () => {
  const uuid = '3f00facc-1857-4a9b-9918-fa65273c27c8'; const prefix = `pilgrims/${uuid}/`
  const names = [`${prefix}passport/1-rahasia-budi.pdf`, `${prefix}ktp/2.jpg`, `${prefix}x/3.pdf`]
  assert.equal(await deleteObjectsByPrefix(prefix, { list: async () => names, remove: async () => [] }), 3, 'kontrol positif')
  assert.equal(await deleteObjectsByPrefix(prefix, { list: async () => [], remove: async () => { throw new Error('tak boleh dipanggil') } }), 0)
  await assert.rejects(deleteObjectsByPrefix(prefix, { list: async () => names, remove: async () => [{ Code: 'AccessDenied', Key: names[0] }] }), (e: Error) => /1 dari 3 objek gagal/.test(e.message) && !/rahasia|passport|budi/.test(e.message))
  await assert.rejects(deleteObjectsByPrefix(prefix, { list: async () => { throw new Error('list gagal') }, remove: async () => [] }), /list gagal/)
})

await t('S57-LOW1 end-to-end: removeObjects parsial gagal → baris Document TIDAK dihapus (berkas masih ada, jangan dilaporkan bersih) dan dihitung gagal', async () => {
  const s = await seed(); const f = fakeDeps()
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, f.deps)).ok, true)
  await injectLateWrites(s, s.email)
  const failing = { deleteByPrefix: (prefix: string) => deleteObjectsByPrefix(prefix, { list: async () => [`${prefix}terlambat.pdf`], remove: async () => [{ Code: 'AccessDenied' }] }) }
  await assert.rejects(sweepErasedAccount(s.userId, failing), /gagal dihapus/)
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 1, 'baris Document harus tetap ada agar sapuan berikutnya mencoba lagi')
  const origErr = console.error; console.error = () => {}
  try { const sum = await sweepRecentErasures(7, failing); assert.ok(sum.failed >= 1) } finally { console.error = origErr }
  // kontrol: setelah penyimpanan pulih, sapuan berikutnya menuntaskan
  assert.ok(await sweepErasedAccount(s.userId, { deleteByPrefix: async () => 1 }))
  assert.equal(await prisma.document.count({ where: { bookingPilgrimId: s.pilgrimId } }), 0)
})

await t('S57-LOW3: sapuan memakai paralelisme TERBATAS (≤5 sekaligus, >1 membuktikan paralel) untuk booking dengan banyak jamaah', async () => {
  const s = await seed()
  await prisma.bookingPilgrim.createMany({ data: Array.from({ length: 11 }, () => ({ bookingId: s.bookingId, fieldValues: {} })) })
  let inflight = 0, peak = 0; const swept = new Set<string>()
  const deps = { deleteByPrefix: async (prefix: string) => { swept.add(prefix); inflight++; peak = Math.max(peak, inflight); await new Promise((r) => setTimeout(r, 25)); inflight--; return 0 } }
  const f = fakeDeps()
  assert.equal((await executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, { ...f.deps, deleteByPrefix: deps.deleteByPrefix })).ok, true)
  assert.ok(peak > 1 && peak <= 5, `puncak paralelisme ${peak} harus 2..5`)
  assert.equal(swept.size, 12, 'SEMUA 12 jamaah harus tersapu (1 asli + 11 tambahan), bukan hanya gelombang pertama')
})

await t('S57-LOW3: MinIO menggantung → executeDeletion tetap kembali dalam batas waktu (penghapusan final; cron menjamin sisanya)', async () => {
  const s = await seed(); const f = fakeDeps()
  const hanging = { ...f.deps, deleteByPrefix: () => new Promise<number>(() => {}), sweepTimeoutMs: 200 }
  const started = Date.now()
  const r = await Promise.race([executeDeletion(s.requestId, admin.id, { confirmEmail: s.email }, hanging), new Promise<'macet'>((res) => setTimeout(() => res('macet'), 8000))])
  assert.notEqual(r, 'macet', 'executeDeletion macet menunggu sapuan')
  assert.equal((r as { ok: boolean }).ok, true); assert.ok(Date.now() - started < 6000)
  assert.equal((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: s.requestId } })).status, 'completed')
})

await t('deleteObjectsByPrefix: awalan selain `pilgrims/<uuid>/` DITOLAK sebelum menyentuh SDK (awalan kosong = hapus seluruh bucket); kontrol: awalan sah lolos validasi', async () => {
  const uuid = '3f00facc-1857-4a9b-9918-fa65273c27c8'
  for (const bad of ['', '/', 'pilgrims/', 'pilgrims', 'pilgrims/x/', `pilgrims/${uuid}`, `other/${uuid}/`, `pilgrims/${uuid}/passport/`, `pilgrims/${uuid}/../`, '../', `pilgrims//${uuid}/`, `PILGRIMS/${uuid}/`, `pilgrims/${uuid.toUpperCase()}/`, `pilgrims/${uuid}/\n`, `pilgrims/${uuid}/ `, `pilgrims/${uuid}/\t`, `\npilgrims/${uuid}/`, `pilgrims/${uuid}/%2e%2e/`]) {
    await assert.rejects(deleteObjectsByPrefix(bad), /tidak valid/, JSON.stringify(bad))
  }
  // kontrol positif: validasi lolos dan baru gagal di jaringan (port tertutup) — pesan galatnya BUKAN "tidak valid"
  const keep = { e: env.MINIO_ENDPOINT, p: env.MINIO_PORT }; env.MINIO_ENDPOINT = '127.0.0.1'; env.MINIO_PORT = '1'
  try {
    await assert.rejects(deleteObjectsByPrefix(`pilgrims/${uuid}/`), (e: Error) => !/tidak valid/.test(e.message))
  } finally { env.MINIO_ENDPOINT = keep.e; env.MINIO_PORT = keep.p }
})

console.log('== penjaga sumber ==')

await t('route admin: hanya lewat executeDeletion/rejectDeletion, .strict(), wajib confirmEmail untuk completed, tak ada update langsung', async () => {
  const src = readFileSync('app/api/v1/admin/deletion-requests/[id]/route.ts', 'utf8')
  assert.match(src, /executeDeletion\(/); assert.match(src, /rejectDeletion\(/)
  assert.match(src, /\.strict\(\)/); assert.match(src, /confirmEmail/); assert.match(src, /requireSuperAdmin\(\)/)
  assert.doesNotMatch(src, /accountDeletionRequest\.update/, 'jalur lama (update status saja) tidak boleh kembali')
  assert.match(src, /req\.json\(\)\.catch\(/)
})

await t('route pengajuan: hanya pilgrim + rate limit + lewat submit/withdraw; GET tanpa catatan admin; pratinjau & admin: superadmin, 401≠403', async () => {
  const acc = readFileSync('app/api/v1/account/deletion-requests/route.ts', 'utf8')
  assert.match(acc, /session\.role !== 'pilgrim'/); assert.match(acc, /policy\('deletionRequestUser'/)
  assert.match(acc, /submitDeletionRequest\(/); assert.match(acc, /withdrawDeletionRequest\(/)
  const get = acc.slice(acc.indexOf('export async function GET'), acc.indexOf('export async function POST')).replace(/\/\/[^\n]*/g, '') // tanpa komentar
  assert.match(get, /select:\s*\{[^}]*status: true/); assert.doesNotMatch(get, /note: true|processedById|erasureSummary/)
  for (const f of ['app/api/v1/admin/deletion-requests/[id]/route.ts', 'app/api/v1/admin/deletion-requests/[id]/preview/route.ts', 'app/api/v1/admin/deletion-requests/route.ts']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /requireSuperAdmin\(\)/, f); assert.match(src, /status: 401/, f); assert.match(src, /status: 403/, f)
  }
})

await t('SEC-57 penjaga sumber: unggah dokumen memeriksa ulang pemilik sebelum menulis baris; cron penyapuan terdaftar; penyapuan memeriksa akun terhapus + completed', async () => {
  const up = readFileSync('app/api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/route.ts', 'utf8')
  const post = up.slice(up.indexOf('export async function POST'))
  const guard = post.search(/if \(!owner\?\.isActive\) \{[\s\S]*?deleteObject\(objectKey\)[\s\S]*?return NextResponse\.json\(err\('Unauthorized'\), \{ status: 401 \}\)/)
  assert.ok(guard > 0 && guard < post.indexOf('prisma.document.create'), 'pemilik nonaktif → buang berkas + 401, SEBELUM document.create')
  assert.match(readFileSync('instrumentation-node.ts', 'utf8'), /startErasureSweepJob\(\)/)
  const sw = readFileSync('lib/account/erasureSweep.ts', 'utf8')
  assert.ok(sw.includes('ERASED_EMAIL.test') && sw.includes("status: 'completed'"))
})

await t('tiap kolom userId pada skema punya perlakuan eksplisit di penghapusan (skema bertambah → tes ini merah sampai ditinjau)', async () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const found = new Set<string>()
  for (const [, name, body] of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (name === 'User') continue
    for (const line of body!.split('\n')) { const m = line.trim().match(/^(\w*[uU]serId)\s+String/); if (m) found.add(`${name}.${m[1]}`) }
  }
  // Perlakuan tiap kolom (harus cocok dengan lib/account/deletion.ts). Menambah kolom userId baru WAJIB menambah baris di sini DAN menanganinya di sana.
  const HANDLED: Record<string, string> = {
    'AccountDeletionRequest.userId': 'dipertahankan (akuntabilitas)',
    'ConsentLog.userId': 'dipertahankan (bukti persetujuan)',
    'AuthToken.userId': 'authToken.deleteMany',
    'Booking.userId': 'dipertahankan; PII anak-anaknya dihapus (fieldValues/dokumen/teks bebas)',
    'BookingPilgrim.userId': 'bookingPilgrim.updateMany (userId → null)',
    'Group.leaderUserId': 'dipertahankan (struktur grup); groupName belum dibuat oleh kode mana pun (INFO-7)',
    'GroupMember.userId': 'groupMember.updateMany',
    'NotificationLog.userId': 'notificationLog.updateMany',
    'BookingAdjustment.byUserId': 'dipertahankan (jejak audit penyesuaian harga oleh STAF; catatan `reason` pesanan jamaah dibersihkan — lihat bookingAdjustment.updateMany)',
    'PriceChange.byUserId': 'dipertahankan (jejak audit harga oleh STAF; jalur UU PDP hanya untuk jamaah — blockersFor menolak akun bukan jamaah)',
  }
  assert.deepEqual([...found].sort(), Object.keys(HANDLED).sort(), 'kolom userId baru/hilang — tinjau penanganan penghapusan')
  const src = readFileSync('lib/account/deletion.ts', 'utf8')
  for (const must of ['bookingAdjustment.updateMany', 'costActual.updateMany', 'authToken.deleteMany', 'notificationLog.updateMany', 'groupMember.updateMany', 'document.deleteMany', 'bookingPilgrim.updateMany', 'address.delete', 'bookingTransport.updateMany', 'payment.updateMany', 'refund.updateMany']) assert.ok(src.includes(must), must)
  // Kolom teks bebas yang diketahui pada baris yang DIPERTAHANKAN harus dibersihkan (DEL-01).
  for (const col of ['pickupDetail', 'dropoffDetail']) assert.ok(src.includes(col), col)
  assert.ok(/notes: null/.test(src))
})

// ── bersih-bersih (urut FK) ──
const ids = createdUsers
const bookingIds = (await prisma.booking.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((b) => b.id)
await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } })
await prisma.refund.deleteMany({ where: { bookingId: { in: bookingIds } } })
await prisma.notificationLog.deleteMany({ where: { userId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } }) // cascade: snapshot, penyesuaian, pengeluaran aktual
await prisma.vendor.deleteMany({ where: { name: { startsWith: 'Vendor Hapus ' } } })
if (chain.pricing) { await prisma.transportQuota.deleteMany({ where: { pricingId: chain.pricing } }); await prisma.transportPricing.delete({ where: { id: chain.pricing } }); await prisma.transportTrip.delete({ where: { id: chain.trip! } }); await prisma.transportVehicle.delete({ where: { id: chain.vehicle! } }) }
await prisma.groupMember.deleteMany({ where: { OR: [{ userId: { in: ids } }, { group: { leaderUserId: { in: ids } } }] } })
await prisma.group.deleteMany({ where: { leaderUserId: { in: ids } } })
await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: ids } } })
await prisma.consentLog.deleteMany({ where: { userId: { in: ids } } })
await prisma.authToken.deleteMany({ where: { OR: [{ userId: { in: ids } }, { email: { startsWith: tag } }] } })
const addr = (await prisma.user.findMany({ where: { id: { in: ids } }, select: { addressId: true } })).map((u) => u.addressId).filter((x): x is string => !!x)
await prisma.user.deleteMany({ where: { id: { in: ids } } })
await prisma.address.deleteMany({ where: { id: { in: addr } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
