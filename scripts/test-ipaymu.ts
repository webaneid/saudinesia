// iPaymu (docs/arsitektur-booking-engine-v2.md §10.12 Fase 9) terhadap DATABASE SUNGGUHAN (sekali pakai) + server iPaymu TIRUAN:
// signature permintaan, biaya per kelompok kanal, masa berlaku, buat pembayaran (batas nominal, satu aktif), sinkronisasi (hanya /transaction yang dipercaya —
// nominal/ReferenceId tak cocok ditolak), konfirmasi otomatis idempoten + buku kas (pokok/biaya_layanan/mdr di akun iPaymu) + kursi, uang terlambat (K9-4),
// rekonsiliasi, callback (form/JSON, X-Signature), CHECK DB, dan penjaga sumber.
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { clearChannelCache, parseCallback, requestSignature, trxState, verifyCallbackSignature, type IpaymuConfig } from '@/lib/payments/ipaymu'
import { gatewayFee } from '@/lib/payments/feeCalc'
import { cancelGatewayPayment, createGatewayPayment, expiryHours, reconcileGatewayPayments, syncGatewayPayment } from '@/lib/payments/gateway'
import { UNPAID_ACTIVE, expireOverdueBookings } from '@/lib/booking/expire'
import { proposeRefund } from '@/lib/refunds/service'
import { ipaymuFromEnv } from '@/lib/payments/ipaymu'
import { startFakeServer } from './lib/fakeServer'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = process.cwd()

// ── server iPaymu tiruan ──────────────────────────────────────────────────────────────────────────
const VA = '0000001234567890'
const KEY = 'SANDBOX-KEY-UJI'
type Trx = { ref: string; amount: number; fee: number; status: number }
const trx = new Map<string, Trx>()
let nextTrx = 9000
let omitTrxId = false
let failDirect = false
let badSignatures = 0
const fake = await startFakeServer(req => {
  const body = req.method === 'GET' ? '{}' : JSON.stringify(req.body)
  if (req.headers.get('signature') !== requestSignature({ va: VA, apiKey: KEY }, req.method as 'GET' | 'POST', body) || req.headers.get('va') !== VA) {
    badSignatures++
    return { status: 401, body: { Status: 401, Success: false, Message: 'unauthorized' } }
  }
  if (req.path === '/payment-channels') {
    return { status: 200, body: { Success: true, Data: [
      { Code: 'va', Name: 'Virtual Account', Channels: [{ Code: 'bca', Name: 'BCA' }, { Code: 'bni', Name: 'BNI' }] },
      { Code: 'qris', Name: 'QRIS', Channels: [{ Code: 'mpm', Name: 'QRIS' }] },
      { Code: 'cc', Name: 'Kartu kredit', Channels: [{ Code: 'cc', Name: 'CC' }] }, // kelompok tak didukung → dibuang
      { Code: 'cstore', Name: 'Minimarket', Channels: [{ Code: 'alfamart', Name: 'Alfamart' }, { Code: 'bad code!', Name: 'X' }] },
    ] } }
  }
  if (req.path === '/payment/direct') {
    if (failDirect) return { status: 200, body: { Success: false, Message: 'channel nonaktif' } }
    const id = String(++nextTrx)
    const b = req.body as { referenceId: string; amount: number; paymentMethod: string }
    trx.set(id, { ref: b.referenceId, amount: b.amount, fee: 4000, status: 0 })
    return { status: 200, body: { Success: true, Data: {
      ...(omitTrxId ? {} : { TransactionId: Number(id) }), ReferenceId: b.referenceId, PaymentName: 'BCA Virtual Account', Expired: '2099-01-01 10:00:00', Total: b.amount,
      ...(b.paymentMethod === 'qris' ? { QrString: '00020101021226...QR' } : { PaymentNo: `8808${id}` }),
    } } }
  }
  if (req.path === '/transaction') {
    const id = String((req.body as { transactionId: string }).transactionId)
    const x = trx.get(id)
    if (!x) return { status: 200, body: { Success: false, Message: 'not found' } }
    return { status: 200, body: { Success: true, Data: { TransactionId: Number(id), ReferenceId: x.ref, Status: x.status, Amount: x.amount, Fee: x.fee, SuccessDate: x.status === 1 ? '2026-11-17 10:15:00' : null } } }
  }
  return { status: 404, body: {} }
})
const cfg: IpaymuConfig = { va: VA, apiKey: KEY, baseUrl: `http://127.0.0.1:${fake.port}` }
const trxOf = (paymentId: string) => [...trx.entries()].find(([, v]) => v.ref === paymentId)

// ── data uji ──────────────────────────────────────────────────────────────────────────────────────
const tag = `ipm${Date.now()}`
const settingsBefore = await prisma.invoiceSettings.findUniqueOrThrow({ where: { id: 'global' }, select: { methodIpaymu: true, minimumFirstPaymentPercent: true } })
await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { methodIpaymu: true, minimumFirstPaymentPercent: 0 } })
const user = await prisma.user.create({ data: { email: `${tag}@example.test`, passwordHash: 'x', fullName: 'Uji iPaymu', phone: '+6281234567890', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
const other = await prisma.user.create({ data: { email: `${tag}-o@example.test`, passwordHash: 'x', fullName: 'Orang Lain', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date() } })
await prisma.gatewayFeeRule.deleteMany({ where: { gateway: 'ipaymu' } })
await prisma.gatewayFeeRule.create({ data: { gateway: 'ipaymu', channelGroup: 'va', percent: 0, flatIdr: 4000 } })
await prisma.gatewayFeeRule.create({ data: { gateway: 'ipaymu', channelGroup: 'qris', percent: 0.7, flatIdr: 0 } })
let n = 0
async function booking(o: { total?: number } = {}) {
  const b = await prisma.booking.create({ data: { bookingCode: `${tag}-${++n}`, userId: user.id, status: 'active', season: 'regular', totalAmount: o.total ?? 1_000_000 } })
  await prisma.invoice.create({ data: { bookingId: b.id, number: `${tag}-INV-${n}`, sequenceKey: `i${n}`.slice(0, 8), sequence: n, issuedAt: new Date(), invoiceDate: new Date('2090-03-10'), dueDate: new Date('2090-03-14'), companySnapshot: {} } })
  return b
}
const entries = (refId: string) => prisma.cashEntry.findMany({ where: { refId }, orderBy: [{ direction: 'asc' }, { component: 'asc' }], include: { cashAccount: { select: { systemKey: true } } } })
  .then(es => es.map(e => [e.direction, e.component, Number(e.amountIdr), e.cashAccount.systemKey]))
async function created(bookingId: string, amount: number, channelId = 'va:bca') {
  const r = await createGatewayPayment({ bookingId, userId: user.id, amount, channelId }, cfg)
  assert.equal(r.kind, 'done', JSON.stringify(r))
  return (r as { paymentId: string }).paymentId
}

// ── murni ─────────────────────────────────────────────────────────────────────────────────────────
await t('signature permintaan = HMAC-SHA256(apiKey, "POST:va:sha256(body):apiKey") hex', () => {
  const body = '{"a":1}'
  const bodyHash = createHash('sha256').update(body).digest('hex')
  assert.equal(requestSignature({ va: VA, apiKey: KEY }, 'POST', body), createHmac('sha256', KEY).update(`POST:${VA}:${bodyHash}:${KEY}`).digest('hex'))
})
await t('biaya layanan per kelompok: persen dibulatkan ke atas + tetap; kelompok tanpa aturan = 0', () => {
  const rules = [{ channelGroup: 'va', percent: 0, flatIdr: 4000 }, { channelGroup: 'qris', percent: 0.7, flatIdr: 0 }]
  assert.equal(gatewayFee(1_000_000, 'va', rules), 4000)
  assert.equal(gatewayFee(1_000_001, 'qris', rules), 7001) // 7000,007 → 7001
  assert.equal(gatewayFee(1_000_000, 'cstore', rules), 0)
})
await t('masa berlaku: 24 jam, dipotong ke akhir hari jatuh tempo bila lebih dekat; sudah lewat → 24 jam', () => {
  const now = new Date('2026-11-17T03:00:00Z') // 10:00 WIB
  assert.equal(expiryHours(null, now), 24)
  assert.equal(expiryHours(new Date('2026-12-30T00:00:00Z'), now), 24)
  assert.equal(expiryHours(new Date('2026-11-17T05:00:00Z'), now), 14) // akhir hari 17 Nov WIB = 17:00Z → 14 jam
  assert.equal(expiryHours(new Date('2026-11-10T00:00:00Z'), now), 24)
})
await t('status iPaymu: 1/6 lunas, 0 menunggu, -2 kedaluwarsa, lainnya gagal', () => {
  assert.deepEqual([1, 6, 0, -2, 2, 'x'].map(trxState), ['paid', 'paid', 'pending', 'expired', 'failed', 'failed'])
})
await t('callback: form-urlencoded & JSON diurai; X-Signature (kunci A-Z, HMAC dengan VA) cocok, diubah → tidak', () => {
  const p = parseCallback('trx_id=9001&status=berhasil&status_code=1&reference_id=abc&url=https%3A%2F%2Fx.y%2Fz', 'application/x-www-form-urlencoded')!
  assert.equal(p.trx_id, '9001')
  assert.deepEqual(parseCallback('{"reference_id":"abc"}', 'application/json'), { reference_id: 'abc' })
  assert.equal(parseCallback('[1]', 'application/json'), null)
  const norm = JSON.stringify(Object.fromEntries(Object.entries({ additional_info: [], reference_id: 'abc', status: 'berhasil', status_code: 1, trx_id: 9001, url: 'https://x.y/z' })))
  const sig = createHmac('sha256', VA).update(norm.replace(/\//g, '\\/')).digest('hex')
  assert.ok(verifyCallbackSignature(VA, p, sig))
  assert.equal(verifyCallbackSignature(VA, { ...p, status_code: '0' }, sig), false)
  assert.equal(verifyCallbackSignature(VA, p, null), false)
})

// ── buat pembayaran ───────────────────────────────────────────────────────────────────────────────
await t('metode iPaymu mati → tak tersedia; kanal di luar daftar / kelompok tak didukung → ditolak', async () => {
  const b = await booking()
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { methodIpaymu: false } })
  assert.equal((await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1000, channelId: 'va:bca' }, cfg)).kind, 'unavailable')
  await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { methodIpaymu: true } })
  for (const ch of ['va:mandiri', 'cc:cc', 'cstore:bad code!']) assert.equal((await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1000, channelId: ch }, cfg)).kind, 'channel', ch)
  assert.equal((await createGatewayPayment({ bookingId: b.id, userId: other.id, amount: 1000, channelId: 'va:bca' }, cfg)).kind, 'not_found', 'bukan pemilik')
})
await t('nominal dinilai seperti transfer (di atas sisa ditolak); sukses → awaiting + biaya + nomor VA + id transaksi; total ke iPaymu = nominal + biaya', async () => {
  const b = await booking()
  const over = await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1_000_001, channelId: 'va:bca' }, cfg)
  assert.equal(over.kind, 'refused')
  const id = await created(b.id, 400_000)
  const p = await prisma.payment.findUniqueOrThrow({ where: { id } })
  assert.equal(p.status, 'awaiting'); assert.equal(p.gateway, 'ipaymu'); assert.equal(Number(p.amount), 0)
  assert.equal(Number(p.claimedAmountIdr), 400_000); assert.equal(Number(p.serviceFeeIdr), 4000)
  assert.ok(p.gatewayTrxId && p.payCode?.startsWith('8808') && p.payExpiresAt)
  assert.equal(trxOf(id)![1].amount, 404_000)
  assert.equal((await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1000, channelId: 'va:bni' }, cfg)).kind, 'busy', 'satu aktif per booking (K9-3)')
})
await t('iPaymu menolak → baris dikedaluwarsakan (tak ada transaksi gantung), booking bisa mencoba lagi', async () => {
  const b = await booking()
  failDirect = true
  const r = await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1000, channelId: 'va:bca' }, cfg)
  failDirect = false
  assert.equal(r.kind, 'gateway')
  assert.equal(await prisma.payment.count({ where: { bookingId: b.id, status: 'awaiting' } }), 0)
  await created(b.id, 1000)
})

// ── sinkronisasi & konfirmasi ─────────────────────────────────────────────────────────────────────
await t('menunggu → pending; nominal di iPaymu ≠ yang diminta → mismatch (tak dikonfirmasi)', async () => {
  const b = await booking()
  const id = await created(b.id, 500_000)
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'pending')
  const [tid, x] = trxOf(id)!
  trx.set(tid, { ...x, status: 1, amount: 1 })
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'mismatch')
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id } })).status, 'awaiting')
})
await t('lunas → confirmed OTOMATIS (tanpa staf), buku kas akun iPaymu: pokok + biaya_layanan masuk, mdr keluar; kursi terkonfirmasi; sinkron ulang idempoten', async () => {
  const b = await booking()
  const id = await created(b.id, 300_000)
  const [tid, x] = trxOf(id)!
  trx.set(tid, { ...x, status: 1 })
  const r = await syncGatewayPayment(id, { override: cfg })
  assert.equal(r.kind, 'confirmed')
  const p = await prisma.payment.findUniqueOrThrow({ where: { id } })
  assert.equal(p.status, 'confirmed'); assert.equal(Number(p.amount), 300_000); assert.equal(p.confirmedById, null); assert.equal(Number(p.gatewayFeeIdr), 4000)
  assert.deepEqual(await entries(id), [['in', 'pokok', 300_000, 'gateway:ipaymu'], ['in', 'biaya_layanan', 4000, 'gateway:ipaymu'], ['out', 'mdr', 4000, 'gateway:ipaymu']])
  const bk = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
  assert.ok(bk.confirmedAt); assert.equal(bk.confirmedById, null)
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'already')
  assert.equal((await entries(id)).length, 3, 'tak ada posting ganda')
})
await t('dibatalkan pelanggan lalu TETAP dibayar di iPaymu → tetap dicatat (K9-4); batal kedua → conflict; bukan pemilik → not_found', async () => {
  const b = await booking()
  const id = await created(b.id, 200_000)
  assert.equal(await cancelGatewayPayment(id, other.id), 'not_found')
  assert.equal(await cancelGatewayPayment(id, user.id), 'done')
  assert.equal(await cancelGatewayPayment(id, user.id), 'conflict')
  const [tid, x] = trxOf(id)!
  trx.set(tid, { ...x, status: 1 })
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'confirmed')
})
await t('booking sudah batal (ditahan/retain) saat uang masuk → seluruhnya KELEBIHAN, tanpa notifikasi lunas, kursi tidak dikonfirmasi; uang telat boleh diusulkan refund (SEC-259)', async () => {
  const b = await booking()
  const id = await created(b.id, 100_000)
  await prisma.booking.update({ where: { id: b.id }, data: { status: 'cancelled' } })
  await prisma.bookingCancellation.create({ data: { bookingId: b.id, cancelledAt: new Date(), reason: 'uji', paidIdr: 50_000, decision: 'retain', decidedAt: new Date(), decidedById: user.id } })
  const [tid, x] = trxOf(id)!
  trx.set(tid, { ...x, status: 6 })
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'late')
  assert.deepEqual(await entries(id), [['in', 'kelebihan', 100_000, 'gateway:ipaymu'], ['in', 'biaya_layanan', 4000, 'gateway:ipaymu'], ['out', 'mdr', 4000, 'gateway:ipaymu']])
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).confirmedAt, null)
  assert.equal((await proposeRefund(b.id, { amount: 100_001, reason: 'uji', byUserId: user.id })).kind, 'decision_pending', 'melebihi uang telat')
  assert.equal((await proposeRefund(b.id, { amount: 100_000, reason: 'uji', byUserId: user.id })).kind, 'done')
  assert.equal((await proposeRefund(b.id, { amount: 1, reason: 'uji', byUserId: user.id })).kind, 'decision_pending', 'uang telat sudah diusulkan seluruhnya')
})
await t('tanpa id transaksi tersimpan: petunjuk dari callback dipakai HANYA bila /transaction menyatakan ReferenceId = pembayaran ini', async () => {
  omitTrxId = true
  const b1 = await booking(); const b2 = await booking()
  const id1 = await created(b1.id, 150_000); const id2 = await created(b2.id, 150_000)
  omitTrxId = false
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: id1 } })).gatewayTrxId, null)
  const [t1, x1] = trxOf(id1)!; const [t2, x2] = trxOf(id2)!
  trx.set(t1, { ...x1, status: 1 }); trx.set(t2, { ...x2, status: 1 })
  assert.equal((await syncGatewayPayment(id1, { override: cfg })).kind, 'pending', 'tanpa petunjuk tak bisa ditanyakan')
  assert.equal((await syncGatewayPayment(id1, { override: cfg, trxIdHint: t2 })).kind, 'mismatch', 'transaksi milik pembayaran lain')
  assert.equal((await syncGatewayPayment(id1, { override: cfg, trxIdHint: "1' OR 1=1" })).kind, 'pending', 'petunjuk berbentuk aneh diabaikan')
  assert.equal((await syncGatewayPayment(id1, { override: cfg, trxIdHint: t1 })).kind, 'confirmed')
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: id1 } })).gatewayTrxId, t1)
})
await t('kedaluwarsa di iPaymu → expired; rekonsiliasi mengedaluwarsakan awaiting tanpa id transaksi yang lewat batas; awaiting menahan hangus', async () => {
  const b = await booking()
  const id = await created(b.id, 120_000)
  assert.equal(await prisma.booking.count({ where: { id: b.id, ...UNPAID_ACTIVE } }), 1, 'VA bukan uang: batas pesanan checkout (SEC-221) tetap menghitungnya')
  const [tid, x] = trxOf(id)!
  trx.set(tid, { ...x, status: -2 })
  assert.equal((await syncGatewayPayment(id, { override: cfg })).kind, 'expired')
  assert.equal(await prisma.booking.count({ where: { id: b.id, ...UNPAID_ACTIVE } }), 1)
  omitTrxId = true
  const b2 = await booking()
  const id2 = await created(b2.id, 120_000)
  omitTrxId = false
  await prisma.payment.update({ where: { id: id2 }, data: { payExpiresAt: new Date(Date.now() - 2 * 3_600_000) } })
  await reconcileGatewayPayments({ override: cfg })
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: id2 } })).status, 'expired')
})
await t('hangus (SEC-256): pesanan checkout lewat jatuh tempo ditahan HANYA oleh VA yang masih hidup; lewat batasnya → booking hangus + VA ditutup; VA baru ditolak', async () => {
  const b = await booking()
  const id = await created(b.id, 110_000)
  await prisma.invoice.update({ where: { bookingId: b.id }, data: { invoiceDate: new Date('2019-12-30'), dueDate: new Date('2020-01-01') } })
  assert.equal((await createGatewayPayment({ bookingId: b.id, userId: user.id, amount: 1000, channelId: 'va:bni' }, cfg)).kind, 'closed', 'lewat jatuh tempo: tak bisa membuat VA baru')
  await expireOverdueBookings()
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status, 'active', 'VA hidup menahan')
  await prisma.payment.update({ where: { id }, data: { payExpiresAt: new Date(Date.now() - 60_000) } })
  await expireOverdueBookings()
  assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })).status, 'expired')
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id } })).status, 'expired')
})
await t('sandbox (SEC-257): hanya di development atau IPAYMU_SANDBOX_ALLOWED=1; selain itu tak ada konfigurasi (fail-closed)', () => {
  const env = process.env as Record<string, string | undefined>
  const saved = { va: env.IPAYMU_VA, key: env.IPAYMU_API_KEY, node: env.NODE_ENV, allow: env.IPAYMU_SANDBOX_ALLOWED }
  env.IPAYMU_VA = VA; env.IPAYMU_API_KEY = KEY; env.NODE_ENV = 'production'; delete env.IPAYMU_SANDBOX_ALLOWED
  try {
    assert.equal(ipaymuFromEnv(true), null)
    assert.match(ipaymuFromEnv(false)!.baseUrl, /my\.ipaymu/)
    env.IPAYMU_SANDBOX_ALLOWED = '1'
    assert.match(ipaymuFromEnv(true)!.baseUrl, /sandbox\.ipaymu/)
    delete env.IPAYMU_SANDBOX_ALLOWED; env.NODE_ENV = 'development'
    assert.ok(ipaymuFromEnv(true))
  } finally {
    for (const [k, v] of [['IPAYMU_VA', saved.va], ['IPAYMU_API_KEY', saved.key], ['NODE_ENV', saved.node], ['IPAYMU_SANDBOX_ALLOWED', saved.allow]] as const) { if (v === undefined) delete env[k]; else env[k] = v }
  }
})
await t('kanal & signature: semua permintaan ke iPaymu tiruan bertanda tangan sah; kanal tak didukung/berkode aneh dibuang', async () => {
  assert.equal(badSignatures, 0)
  clearChannelCache()
})

// ── CHECK DB ──────────────────────────────────────────────────────────────────────────────────────
await t('CHECK: pembayaran manual tak boleh berkolom gateway / berstatus awaiting; gateway tak boleh berkode unik / confirmed tanpa id transaksi; akun kas gateway berkunci gateway:', async () => {
  const b = await booking()
  const bad = [
    `INSERT INTO payments (id,"bookingId",amount,method,status) VALUES (gen_random_uuid(),'${b.id}',0,'bank_transfer','awaiting')`,
    `INSERT INTO payments (id,"bookingId",amount,method,status,"serviceFeeIdr") VALUES (gen_random_uuid(),'${b.id}',0,'bank_transfer','pending',1)`,
    `INSERT INTO payments (id,"bookingId",amount,method,status,gateway,channel,"claimedAmountIdr") VALUES (gen_random_uuid(),'${b.id}',0,'ipaymu','pending','ipaymu','va:bca',1)`,
    `INSERT INTO payments (id,"bookingId",amount,method,status,gateway,channel,"claimedAmountIdr") VALUES (gen_random_uuid(),'${b.id}',1,'ipaymu','confirmed','ipaymu','va:bca',1)`,
    `INSERT INTO payments (id,"bookingId",amount,method,status,gateway,"claimedAmountIdr") VALUES (gen_random_uuid(),'${b.id}',0,'ipaymu','awaiting','ipaymu',1)`,
    `INSERT INTO cash_accounts (id,kind,name,"systemKey") VALUES (gen_random_uuid(),'gateway','x','cash:lain')`,
    `INSERT INTO gateway_fee_rules (id,gateway,"channelGroup",percent,"updatedAt") VALUES (gen_random_uuid(),'ipaymu','VA X',101,now())`,
  ]
  for (const sql of bad) await assert.rejects(prisma.$executeRawUnsafe(sql), /check|violates/i, sql.slice(0, 90))
})

// ── penjaga sumber ────────────────────────────────────────────────────────────────────────────────
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = `${dir}/${f}`
    if (statSync(join(root, p)).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const files = [...walk('app'), ...walk('lib')]
const src = (f: string) => readFileSync(join(root, f), 'utf8')
await t('penjaga: hanya lib/payments/ipaymu.ts memanggil iPaymu; hanya gateway.ts membuat/mengonfirmasi pembayaran gateway; webhook hanya pemicu sinkronisasi', () => {
  assert.deepEqual(files.filter(f => /ipaymu\.com/.test(src(f))), ['lib/payments/ipaymu.ts'])
  assert.deepEqual(files.filter(f => /status: 'awaiting', gateway:/.test(src(f))), ['lib/payments/gateway.ts'])
  assert.deepEqual(files.filter(f => /confirmedById: null/.test(src(f)) && /payment\.update/.test(src(f))), ['lib/payments/gateway.ts'])
  const hook = src('app/api/v1/webhooks/ipaymu/route.ts')
  assert.match(hook, /syncAndNotify\(ref, \{ trxIdHint: trx \}\)/)
  assert.doesNotMatch(hook, /payment\.(update|create)|status_code\s*===|amount/, 'webhook tak menulis atau mempercayai isi callback')
  assert.match(src('app/api/v1/bookings/[id]/payment/bukti/route.ts'), /onlinePaymentActive/, 'bukti transfer ditolak selama ada pembayaran online menunggu')
  assert.match(src('lib/payments/process.ts'), /payment\.status !== 'pending'/, 'verifikasi admin hanya untuk pembayaran manual (pending)')
})

// ── pembersihan (entri kas append-only — DB sekali pakai) ───────────────────────────────────────
await fake.stop()
const ids = (await prisma.booking.findMany({ where: { userId: user.id }, select: { id: true } })).map(b => b.id)
await prisma.refund.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.bookingCancellation.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.payment.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.invoice.deleteMany({ where: { bookingId: { in: ids } } })
await prisma.booking.deleteMany({ where: { id: { in: ids } } })
await prisma.gatewayFeeRule.deleteMany({ where: { gateway: 'ipaymu' } })
await prisma.user.deleteMany({ where: { email: { contains: tag } } })
await prisma.invoiceSettings.update({ where: { id: 'global' }, data: settingsBefore })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
