// Uji verifikasi WhatsApp lewat pesan masuk (ADR-0002, lib/auth/whatsappVerify.ts): fungsi murni + aturan akun terhadap DATABASE sungguhan.
// PENGAMAN: menulis user/token sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { prisma } from '@/lib/db'
import {
  VERIFICATION_TTL_MS, completeWhatsappVerification, generateCode, jidToDigits, normalizeCode, parseVerificationMessage,
  requestWhatsappVerification, verifyWebhookSignature,
} from '@/lib/auth/whatsappVerify'
import { updateContact } from '@/lib/auth/contact'
import { processWebhook, maskEmail, webhookSecret, WEBHOOK_MAX_BODY_BYTES } from '@/lib/whatsapp/webhook'
import { readFileSync } from 'node:fs'
import { businessWaDigits } from '@/lib/constants/payment'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}

console.log('== fungsi murni ==')

await t('generateCode: 8 karakter dari alfabet tanpa I/L/O/0/1, acak, normalizeCode menerima huruf kecil/spasi/strip dan menolak sisanya', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const c = generateCode()
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
    seen.add(c)
  }
  assert.ok(seen.size > 190) // praktis tak ada tabrakan
  assert.equal(normalizeCode('k7q2-m9xd'), 'K7Q2M9XD')
  assert.equal(normalizeCode(' K7Q2 M9XD '), 'K7Q2M9XD')
  for (const bad of ['K7Q2M9X', 'K7Q2M9XDD', 'K7Q2M9XI', 'K7Q2M9X0', 'K7Q2M9XO', '', 'ABCD!FGH']) assert.equal(normalizeCode(bad), null, bad)
})

await t('parseVerificationMessage: hanya "VERIF <KODE>"/"VERIFIKASI <KODE>"; pesan lain, terlalu panjang, bukan string → null', () => {
  assert.equal(parseVerificationMessage('VERIF K7Q2M9XD'), 'K7Q2M9XD')
  assert.equal(parseVerificationMessage('verif k7q2-m9xd'), 'K7Q2M9XD')
  assert.equal(parseVerificationMessage('  Verifikasi: K7Q2 M9XD  '), 'K7Q2M9XD')
  for (const bad of ['halo', 'VERIF', 'VERIF K7Q2', 'VERIF K7Q2M9XD tolong cepat', 'Tolong VERIF K7Q2M9XD', 'VERIF K7Q2M9X0', 'x'.repeat(100), '', null, undefined, 123, {}]) {
    assert.equal(parseVerificationMessage(bad), null, String(bad))
  }
})

await t('jidToDigits: hanya JID pribadi bernomor (boleh sufiks perangkat); grup, LID, bentuk aneh → null', () => {
  assert.equal(jidToDigits('6281234567890@s.whatsapp.net'), '6281234567890')
  assert.equal(jidToDigits('6281234567890:12@s.whatsapp.net'), '6281234567890')
  for (const bad of ['123456@lid', '6281234567890@g.us', '6281234567890', '@s.whatsapp.net', 'abc@s.whatsapp.net', '1234567@s.whatsapp.net', '6281234567890@s.whatsapp.net.evil.test', '+6281234567890@s.whatsapp.net', null, undefined, 62812]) {
    assert.equal(jidToDigits(bad), null, String(bad))
  }
})

await t('verifyWebhookSignature: HMAC-SHA256 atas body MENTAH; header salah/tanpa/diubah/secret kosong ditolak', () => {
  const secret = 'rahasia-webhook-uji'; const body = '{"event":"message","payload":{"body":"VERIF K7Q2M9XD"}}'
  const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  assert.equal(verifyWebhookSignature(secret, body, sig), true)
  assert.equal(verifyWebhookSignature(secret, body, sig.toUpperCase().replace('SHA256=', 'sha256=')), true) // hex huruf besar tetap sah
  assert.equal(verifyWebhookSignature(secret, body + ' ', sig), false) // body berubah satu spasi
  assert.equal(verifyWebhookSignature('secret-lain', body, sig), false)
  assert.equal(verifyWebhookSignature(secret, body, null), false)
  assert.equal(verifyWebhookSignature(secret, body, ''), false)
  assert.equal(verifyWebhookSignature(secret, body, sig.slice(7)), false) // tanpa awalan sha256=
  assert.equal(verifyWebhookSignature(secret, body, sig.slice(0, -2)), false) // terpotong
  assert.equal(verifyWebhookSignature(secret, body, 'sha256=' + 'z'.repeat(64)), false) // bukan hex
  assert.equal(verifyWebhookSignature('', body, sig), false) // secret kosong tak pernah sah
  assert.equal(verifyWebhookSignature('secret', body, 'sha256=' + createHmac('sha256', '').update(body).digest('hex')), false)
})

console.log('== alur verifikasi ==')

const tag = `wv${Date.now()}`
let n = 0
const email = () => `${tag}-${++n}@example.test`
const num = (i: number) => `62812${String(Date.now()).slice(-6)}${String(i).padStart(2, '0')}`
const mk = (whatsapp: string | null, extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { email: email(), passwordHash: 'x', fullName: 'Uji', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), whatsapp, ...extra } })
/** Hasil sukses juga memuat email (untuk balasan tersamar); uji aturan akun hanya peduli ok + userId. */
const pickOk = (r: Awaited<ReturnType<typeof completeWhatsappVerification>>) => (r.ok ? { ok: true as const, userId: r.userId } : r)
const request = async (userId: string) => { const r = await requestWhatsappVerification(userId); assert.equal(r.ok, true); return (r as { code: string }).code }

await t('sukses: kode dari akun, pesan dari NOMOR YANG SAMA → terverifikasi; tak bisa dipakai ulang; hanya hash kode di DB', async () => {
  const number = num(1); const u = await mk(number)
  const code = await request(u.id)
  const row = await prisma.authToken.findFirstOrThrow({ where: { userId: u.id, type: 'whatsapp_verification' } })
  assert.ok(!JSON.stringify(row).includes(code), 'kode mentah tak boleh ada di DB')
  assert.ok(row.expiresAt.getTime() - Date.now() <= VERIFICATION_TTL_MS)
  assert.deepEqual(pickOk(await completeWhatsappVerification({ code, senderDigits: number })), { ok: true, userId: u.id })
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.ok(after.whatsappVerifiedAt); assert.equal(after.verifiedWhatsapp, number)
  assert.deepEqual(await completeWhatsappVerification({ code, senderDigits: number }), { ok: false, reason: 'invalid' }) // webhook di-retry GOWA → idempoten
})

await t('pengirim BUKAN nomor akun → mismatch, TIDAK terverifikasi, dan kode TIDAK terbakar (pengguna sah masih bisa memakainya)', async () => {
  const number = num(2); const u = await mk(number); const code = await request(u.id)
  assert.deepEqual(await completeWhatsappVerification({ code, senderDigits: num(99) }), { ok: false, reason: 'mismatch' })
  const mid = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.equal(mid.whatsappVerifiedAt, null); assert.equal(mid.verifiedWhatsapp, null)
  assert.deepEqual(pickOk(await completeWhatsappVerification({ code, senderDigits: number })), { ok: true, userId: u.id })
})

await t('kode tak dikenal / berbentuk salah / kedaluwarsa / digantikan permintaan lebih baru → invalid', async () => {
  const number = num(3); const u = await mk(number)
  assert.deepEqual(await completeWhatsappVerification({ code: 'AAAAAAAA', senderDigits: number }), { ok: false, reason: 'invalid' })
  assert.deepEqual(await completeWhatsappVerification({ code: 'pendek', senderDigits: number }), { ok: false, reason: 'invalid' })
  const old = await request(u.id); const fresh = await request(u.id)
  assert.deepEqual(await completeWhatsappVerification({ code: old, senderDigits: number }), { ok: false, reason: 'invalid' })
  await prisma.authToken.updateMany({ where: { userId: u.id, type: 'whatsapp_verification' }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.deepEqual(await completeWhatsappVerification({ code: fresh, senderDigits: number }), { ok: false, reason: 'invalid' })
})

await t('nomor akun DIGANTI setelah kode terbit → kode lama tak berlaku untuk nomor lama maupun baru', async () => {
  const oldNum = num(4); const newNum = num(5); const u = await mk(oldNum, { consentLogs: { create: { type: 'whatsapp_notifications', version: 'uji' } }, phone: oldNum })
  const code = await request(u.id)
  await updateContact(u.id, { phone: oldNum, whatsapp: newNum })
  assert.deepEqual(await completeWhatsappVerification({ code, senderDigits: oldNum }), { ok: false, reason: 'mismatch' })
  assert.deepEqual(await completeWhatsappVerification({ code, senderDigits: newNum }), { ok: false, reason: 'mismatch' }) // kode terikat nomor LAMA
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsappVerifiedAt, null)
})

await t('akun nonaktif / akun tak ada tak bisa diverifikasi', async () => {
  const number = num(6); const u = await mk(number); const code = await request(u.id)
  await prisma.user.update({ where: { id: u.id }, data: { isActive: false } })
  assert.deepEqual(await completeWhatsappVerification({ code, senderDigits: number }), { ok: false, reason: 'invalid' })
  assert.deepEqual(await requestWhatsappVerification('tidak-ada'), { ok: false, reason: 'not_found' })
})

await t('requestWhatsappVerification: tanpa nomor → no_number; sudah terverifikasi → already_verified; kode baru menghanguskan yang lama', async () => {
  const none = await mk(null)
  assert.deepEqual(await requestWhatsappVerification(none.id), { ok: false, reason: 'no_number' })
  const number = num(7); const u = await mk(number)
  await request(u.id); await request(u.id)
  assert.equal(await prisma.authToken.count({ where: { userId: u.id, type: 'whatsapp_verification', usedAt: null } }), 1)
  const code = await request(u.id); await completeWhatsappVerification({ code, senderDigits: number })
  assert.deepEqual(await requestWhatsappVerification(u.id), { ok: false, reason: 'already_verified' })
})

await t('SATU NOMOR = SATU AKUN TERVERIFIKASI: yang pertama membuktikan menang; akun kedua dengan nomor yang sama → taken, tidak terverifikasi', async () => {
  const shared = num(8)
  const a = await mk(shared); const b = await mk(shared) // nomor belum terverifikasi BOLEH sama (keluarga; klaim tanpa bukti tak berlaku)
  const codeA = await request(a.id); const codeB = await request(b.id)
  assert.deepEqual(pickOk(await completeWhatsappVerification({ code: codeA, senderDigits: shared })), { ok: true, userId: a.id })
  assert.deepEqual(await completeWhatsappVerification({ code: codeB, senderDigits: shared }), { ok: false, reason: 'taken' })
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).whatsappVerifiedAt, null)
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).verifiedWhatsapp, shared)
})

await t('BALAPAN: dua akun memverifikasi nomor yang sama bersamaan → tepat satu menang', async () => {
  const shared = num(9)
  const a = await mk(shared); const b = await mk(shared)
  const [ca, cb] = [await request(a.id), await request(b.id)]
  const rs = await Promise.all([completeWhatsappVerification({ code: ca, senderDigits: shared }), completeWhatsappVerification({ code: cb, senderDigits: shared })])
  assert.equal(rs.filter((r) => r.ok).length, 1)
  assert.equal(rs.filter((r) => !r.ok && r.reason === 'taken').length, 1)
  assert.equal(await prisma.user.count({ where: { verifiedWhatsapp: shared } }), 1)
})

await t('ubah nomor WhatsApp mencabut verifikasi (dan membebaskan nomor lama); mengubah telepon saja TIDAK mencabut', async () => {
  const number = num(10); const next = num(11)
  const u = await mk(number, { phone: number, consentLogs: { create: { type: 'whatsapp_notifications', version: 'uji' } } })
  await completeWhatsappVerification({ code: await request(u.id), senderDigits: number })
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsappVerifiedAt)
  await updateContact(u.id, { phone: '966551234567', whatsapp: number }) // hanya telepon
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsappVerifiedAt, 'telepon saja tak boleh mencabut')
  await updateContact(u.id, { phone: '966551234567', whatsapp: next })
  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.equal(after.whatsappVerifiedAt, null); assert.equal(after.verifiedWhatsapp, null)
  // nomor lama kini bebas dibuktikan akun lain
  const other = await mk(number)
  assert.deepEqual(pickOk(await completeWhatsappVerification({ code: await request(other.id), senderDigits: number })), { ok: true, userId: other.id })
})

console.log('== webhook (lib/whatsapp/webhook.ts) ==')

const env = process.env as Record<string, string | undefined>
const SECRET = 'a'.repeat(8) + 'Rahasia-Webhook-Uji-0123456789-XYZ' // ≥32 karakter, bukan nilai lemah
env.WHATSAPP_WEBHOOK_SECRET = SECRET
const signed = (body: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
const msg = (o: Record<string, unknown> = {}) => JSON.stringify({
  event: 'message',
  payload: { id: 'm', chat_id: '', from: '', is_from_me: false, body: '', timestamp: new Date().toISOString(), ...o },
})
const hook = (body: string, o: { ip?: string | null; signature?: string | null } = {}) =>
  processWebhook({ rawBody: body, signature: o.signature === undefined ? signed(body) : o.signature, ip: o.ip === undefined ? `203.0.113.${Math.floor(Math.random() * 250) + 1}` : o.ip })
let ipN = 0
const freshIp = () => `198.51.100.${++ipN}`
const jid = (digits: string) => `${digits}@s.whatsapp.net`
const verifMsg = (digits: string, code: string, extra: Record<string, unknown> = {}) => msg({ chat_id: jid(digits), from: jid(digits), body: `VERIF ${code}`, ...extra })

await t('secret tak ada / terlalu pendek / berentropi rendah (S26-T02) / bawaan GOWA / placeholder → webhook MATI (503) walau tanda tangan cocok dengan secret lemah itu', async () => {
  for (const weak of [undefined, '', 'secret', 'ganti_dengan_string_acak_panjang', 'x'.repeat(31), 'CHANGEME', '   ', 'a'.repeat(40), 'ab'.repeat(20), 'abcdefg'.repeat(6)]) {
    if (weak === undefined) delete env.WHATSAPP_WEBHOOK_SECRET; else env.WHATSAPP_WEBHOOK_SECRET = weak
    assert.equal(webhookSecret(), null, String(weak))
    const body = msg()
    const r = await processWebhook({ rawBody: body, signature: signed(body, weak ?? ''), ip: freshIp() })
    assert.equal(r.status, 503, String(weak))
  }
  env.WHATSAPP_WEBHOOK_SECRET = SECRET
  assert.equal(webhookSecret(), SECRET)
  assert.equal((await hook(msg())).status, 200) // kontrol positif
})

await t('413 dihitung dalam BYTE (22.000 × "€" = 66 KB padahal hanya 22.000 karakter)', async () => {
  const big = msg({ body: '€'.repeat(22000) })
  assert.ok(big.length < WEBHOOK_MAX_BODY_BYTES && Buffer.byteLength(big) > WEBHOOK_MAX_BODY_BYTES)
  assert.equal((await hook(big)).status, 413)
})

await t('tanda tangan tanpa/salah/diubah → 401; percobaan salah dibatasi per IP (ke-31 → 429) dan tak memengaruhi IP lain atau pesan sah', async () => {
  const body = msg(); const ip = freshIp()
  assert.equal((await hook(body, { ip, signature: null })).status, 401)
  assert.equal((await hook(body, { ip, signature: signed(body, 'x'.repeat(40)) })).status, 401)
  assert.equal((await hook(body + ' ', { ip, signature: signed(body) })).status, 401)
  for (let i = 0; i < 27; i++) await hook(body, { ip, signature: 'sha256=' + '0'.repeat(64) })
  const blocked = await hook(body, { ip, signature: 'sha256=' + '0'.repeat(64) })
  assert.equal(blocked.status, 429); assert.ok((blocked.retryAfterSec ?? 0) > 0)
  assert.equal((await hook(body, { ip: freshIp(), signature: 'sha256=' + '0'.repeat(64) })).status, 401) // IP lain tak terdampak
  assert.equal((await hook(body, { ip })).status, 200) // pesan SAH dari IP yang sama tetap lewat (ember berbeda)
})

await t('pesan sah yang harus DIABAIKAN (200, handled=false, tanpa balasan): is_from_me, grup, LID, chat≠pengirim, event lain, bukan JSON, bukan format VERIF, timestamp basi/masa depan', async () => {
  const number = num(20); const u = await mk(number); const code = await request(u.id)
  const cases: Array<[string, string]> = [
    ['is_from_me', verifMsg(number, code, { is_from_me: true })],
    ['grup', msg({ chat_id: '12036@g.us', from: jid(number), body: `VERIF ${code}` })],
    ['LID', msg({ chat_id: '99999@lid', from: '99999@lid', body: `VERIF ${code}` })],
    ['chat ≠ pengirim', msg({ chat_id: jid(num(21)), from: jid(number), body: `VERIF ${code}` })],
    ['event lain', JSON.stringify({ event: 'receipt', payload: {} })],
    ['bukan JSON', 'bukan json sama sekali'],
    ['JSON non-objek', '"teks"'],
    ['bukan format VERIF', verifMsg(number, code, { body: `halo ${code}` })],
    ['timestamp 11 menit lalu', verifMsg(number, code, { timestamp: new Date(Date.now() - 11 * 60 * 1000).toISOString() })],
    ['timestamp 6 menit ke depan', verifMsg(number, code, { timestamp: new Date(Date.now() + 6 * 60 * 1000).toISOString() })],
    ['timestamp bukan tanggal', verifMsg(number, code, { timestamp: 'kemarin' })],
  ]
  for (const [name, body] of cases) {
    const r = await hook(body)
    assert.deepEqual({ status: r.status, handled: r.handled, reply: r.reply }, { status: 200, handled: false, reply: undefined }, name)
  }
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsappVerifiedAt, null, 'tak satu pun boleh memverifikasi')
  // kontrol positif: kode yang SAMA lolos bila pesannya sah (tanpa timestamp pun diterima)
  const ok = await hook(verifMsg(number, code, { timestamp: undefined }))
  assert.equal(ok.handled, true)
})

await t('balasan: hanya untuk sukses (ke PENGIRIM, memuat email tersamar akun) dan taken; mismatch/invalid TIDAK dibalas', async () => {
  const shared = num(22); const a = await mk(shared); const b = await mk(shared)
  const ca = await request(a.id); const cb = await request(b.id)
  const mismatch = await hook(verifMsg(num(23), ca)); assert.equal(mismatch.reply, undefined)
  const invalid = await hook(verifMsg(shared, 'AAAAAAAA')); assert.equal(invalid.reply, undefined)
  const good = await hook(verifMsg(shared, ca))
  assert.equal(good.handled, true); assert.equal(good.reply?.phone, shared)
  assert.ok(good.reply?.message.includes(maskEmail(a.email)), 'balasan memuat email tersamar akun')
  assert.ok(!good.reply?.message.includes(a.email), 'email penuh tak boleh bocor')
  const taken = await hook(verifMsg(shared, cb))
  assert.equal(taken.handled, false); assert.equal(taken.reply?.phone, shared); assert.match(taken.reply?.message ?? '', /akun Saudinesia lain/)
  assert.equal(maskEmail('jamaah@example.test'), 'j***@example.test')
})

await t('batas per PENGIRIM: setelah 10 pesan verifikasi/jam dari satu nomor, berikutnya diabaikan (tebakan kode terbatas) — walau kodenya benar', async () => {
  const number = num(24); const u = await mk(number)
  for (let i = 0; i < 10; i++) await hook(verifMsg(number, 'AAAAAAAA'))
  const code = await request(u.id)
  const r = await hook(verifMsg(number, code))
  assert.equal(r.handled, false); assert.equal(r.status, 200)
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsappVerifiedAt, null)
})

await t('chat biasa (bukan VERIF) TIDAK menghabiskan batas pengirim ataupun mengganggu verifikasi sah', async () => {
  const number = num(25); const u = await mk(number); const code = await request(u.id)
  for (let i = 0; i < 30; i++) await hook(msg({ chat_id: jid(number), from: jid(number), body: `halo ${i}` }))
  assert.equal((await hook(verifMsg(number, code))).handled, true)
})

await t('tanpa IP (di belakang proxy tanpa X-Forwarded-For): webhook tetap bekerja', async () => {
  const number = num(26); const u = await mk(number)
  assert.equal((await hook(verifMsg(number, await request(u.id)), { ip: null })).handled, true)
})

await t('BALAPAN: verifikasi bersamaan dengan pergantian nomor → tak pernah tertinggal verifiedWhatsapp basi', async () => {
  for (let i = 0; i < 6; i++) {
    const oldNum = num(40 + i * 2); const newNum = num(41 + i * 2)
    const u = await mk(oldNum, { phone: oldNum, consentLogs: { create: { type: 'whatsapp_notifications', version: 'uji' } } })
    const code = await request(u.id)
    await Promise.all([completeWhatsappVerification({ code, senderDigits: oldNum }), updateContact(u.id, { phone: oldNum, whatsapp: newNum })])
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
    assert.ok(after.verifiedWhatsapp === null || after.verifiedWhatsapp === after.whatsapp, `basi: whatsapp=${after.whatsapp} verified=${after.verifiedWhatsapp}`)
    assert.equal(after.whatsapp, newNum)
  }
})

await t('route admin: menonaktifkan akun MELEPAS nomor terverifikasi (penjaga tak boleh terhapus diam-diam); route webhook tipis memanggil processWebhook', () => {
  // Logika pindah ke updateUserByAdmin (SEC-18) — perilakunya diuji langsung di test-session; di sini penjaga: route memakainya & helper masih melepas nomor.
  const adminSrc = readFileSync(new URL('../app/api/v1/admin/system/users/[id]/route.ts', import.meta.url), 'utf8')
  assert.ok(adminSrc.includes('updateUserByAdmin('), 'route admin harus lewat updateUserByAdmin (tempat nomor dilepas & sesi dicabut)')
  const helperSrc = readFileSync(new URL('../lib/auth/adminUsers.ts', import.meta.url), 'utf8')
  assert.match(helperSrc, /isActive === false\) \{ data\.whatsappVerifiedAt = null; data\.verifiedWhatsapp = null \}/)
  const hookSrc = readFileSync(new URL('../app/api/v1/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
  assert.ok(hookSrc.includes('processWebhook(') && hookSrc.includes('webhookSecret()') && hookSrc.includes('readLimited('))
  const post = hookSrc.slice(hookSrc.indexOf('export async function POST'))
  assert.ok(post.indexOf('webhookSecret()') > 0 && post.indexOf('webhookSecret()') < post.indexOf('readLimited(request'), 'secret dicek SEBELUM membaca body')
})

await t('businessWaDigits: nomor bisnis 8–15 digit; placeholder (628xxxxxxxxxx → "628"), kosong, berawalan 0, kepanjangan → "" (tak dianggap terisi)', () => {
  assert.equal(businessWaDigits('6281300000000'), '6281300000000')
  assert.equal(businessWaDigits('+62 813-0000-0000'), '6281300000000')
  for (const bad of ['628xxxxxxxxxx', '', '0812345678', '1234567', '1'.repeat(16), 'abc']) assert.equal(businessWaDigits(bad), '', String(bad))
  const keep = env.NEXT_PUBLIC_BUSINESS_WA // tanpa argumen: membaca env (undefined → default parameter)
  try {
    delete env.NEXT_PUBLIC_BUSINESS_WA; assert.equal(businessWaDigits(), '')
    env.NEXT_PUBLIC_BUSINESS_WA = '628xxxxxxxxxx'; assert.equal(businessWaDigits(), '')
    env.NEXT_PUBLIC_BUSINESS_WA = '6281300000000'; assert.equal(businessWaDigits(), '6281300000000')
  } finally { if (keep === undefined) delete env.NEXT_PUBLIC_BUSINESS_WA; else env.NEXT_PUBLIC_BUSINESS_WA = keep }
})

await prisma.authToken.deleteMany({ where: { user: { email: { startsWith: tag } } } })
await prisma.consentLog.deleteMany({ where: { user: { email: { startsWith: tag } } } })
await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
