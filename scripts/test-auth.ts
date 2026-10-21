// Uji lib/auth/{accounts,tokens,authEmail}.ts terhadap DATABASE SUNGGUHAN + Resend PALSU (docs/arsitektur-auth.md §3).
// Fokus keamanan: pendaftaran tidak membuat akun, token hanya hash & sekali pakai, balapan, kedaluwarsa, anti-pre-hijacking.
//
// PENGAMAN: menulis user/token sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { completeRegistration, previewRegistration, requestPasswordReset, requestRegistration, resetPassword } from '@/lib/auth/accounts'
import { hashToken, issueToken, peekToken } from '@/lib/auth/tokens'
import { sendAuthEmail } from '@/lib/auth/authEmail'
import { completeRegistrationSchema, registerSchema } from '@/lib/validators/auth'
import { maskE164 } from '@/lib/utils/phone'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'

const url = process.env.DATABASE_URL ?? ''
const dbName = url.split('/').pop()?.split('?')[0] ?? ''
if (!/(test|_ci|tmp)/i.test(dbName)) {
  console.error(`DITOLAK: database "${dbName}" bukan database uji (harus memuat test / _ci / tmp).`)
  process.exit(2)
}

let failed = 0
async function t(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 5).join('\n     ')}`)
  }
}
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

let mailSeen: FakeRequest[] = []
let mailStatus = 200
const mail = await startFakeServer((req) => { mailSeen.push(req); return { status: mailStatus, body: mailStatus === 200 ? { id: 'msg_auth' } : { message: 'gagal' } } })

const tag = `at${Date.now()}`
let n = 0
const email = () => `${tag}-${++n}@example.test`
const reg = (e: string) => ({ fullName: 'Uji Daftar', email: e, phone: '628111222333', whatsapp: '628111222333', locale: 'id' as const })
const pending = async (e: string) => {
  const r = await requestRegistration(reg(e))
  assert.equal(r.kind, 'pending')
  return (r as { token: string }).token
}
const makeUser = (e: string, extra: Record<string, unknown> = {}) =>
  prisma.user.create({ data: { email: e, passwordHash: 'x', fullName: 'Ada', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...extra } })
const strong = 'Sandi-Kuat1!'

console.log('== pendaftaran ==')

await t('daftar TIDAK membuat akun; data menunggu di token, hanya HASH token disimpan', async () => {
  const e = email()
  const token = await pending(e)
  assert.equal(await prisma.user.count({ where: { email: e } }), 0)
  const rows = await prisma.authToken.findMany({ where: { email: e } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.tokenHash, hashToken(token))
  assert.notEqual(rows[0]!.tokenHash, token)
  assert.equal(JSON.stringify(rows[0]).includes(token), false) // token mentah tidak ada di baris mana pun
})

await t('email sudah terdaftar → already_registered, TIDAK membuat token', async () => {
  const e = email(); await makeUser(e, { fullName: 'Pemilik Asli' })
  const r = await requestRegistration(reg(e))
  assert.deepEqual(r, { kind: 'already_registered', fullName: 'Pemilik Asli' })
  assert.equal(await prisma.authToken.count({ where: { email: e } }), 0)
})

await t('daftar ulang untuk email yang sama menghanguskan tautan lama (hanya yang terbaru berlaku)', async () => {
  const e = email(); const t1 = await pending(e); const t2 = await pending(e)
  assert.equal(await peekToken(t1, 'registration'), null)
  assert.ok(await peekToken(t2, 'registration'))
  assert.equal(await prisma.authToken.count({ where: { email: e, usedAt: null } }), 1)
})

await t('pratinjau menampilkan isian dan TIDAK mengonsumsi token (aman dari pemindai tautan)', async () => {
  const e = email(); const token = await pending(e)
  const p1 = await previewRegistration(token); const p2 = await previewRegistration(token)
  assert.deepEqual(p1, { email: e, fullName: 'Uji Daftar', phone: '628111222333', whatsapp: '628111222333' })
  assert.deepEqual(p2, p1)
})

await t('selesaikan: akun dibuat (email terverifikasi, password bcrypt, 2 ConsentLog), tautan sekali pakai', async () => {
  const e = email(); const token = await pending(e)
  const r = await completeRegistration(token, strong)
  assert.equal(r.ok, true)
  const u = await prisma.user.findUniqueOrThrow({ where: { email: e }, include: { consentLogs: true } })
  assert.equal(u.role, 'pilgrim'); assert.equal(u.isActive, true); assert.ok(u.emailVerifiedAt)
  assert.equal(u.phone, '628111222333'); assert.equal(u.whatsapp, '628111222333')
  assert.equal(await compare(strong, u.passwordHash), true)
  assert.deepEqual(u.consentLogs.map((c) => c.type).sort(), ['privacy_policy', 'whatsapp_notifications'])
  // Persetujuan dicatat SAAT pemilik email menyelesaikan (bukan saat pengirim form mengisi) → waktunya setelah token diterbitkan
  const tokenRow = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } })
  assert.ok(u.consentLogs.every((c) => c.createdAt >= tokenRow.createdAt))
  assert.equal(tokenRow.payload, null) // isian milik pihak ketiga dibuang setelah dipakai (minimalisasi data)
  const again = await completeRegistration(token, 'Sandi-Lain2!')
  assert.deepEqual(again, { ok: false, reason: 'invalid' })
  assert.equal(await compare(strong, (await prisma.user.findUniqueOrThrow({ where: { email: e } })).passwordHash), true) // tidak tertimpa
})

await t('balapan: dua penyelesaian bersamaan untuk satu tautan → tepat satu akun dibuat', async () => {
  const e = email(); const token = await pending(e)
  const rs = await Promise.all([completeRegistration(token, strong), completeRegistration(token, 'Sandi-Lain2!')])
  assert.equal(rs.filter((r) => r.ok).length, 1)
  assert.equal(await prisma.user.count({ where: { email: e } }), 1)
})

await t('kedaluwarsa dan token berbentuk salah ditolak tanpa menyentuh akun', async () => {
  const e = email(); const token = await pending(e)
  await prisma.authToken.updateMany({ where: { email: e }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.deepEqual(await completeRegistration(token, strong), { ok: false, reason: 'invalid' })
  assert.equal(await previewRegistration(token), null)
  assert.deepEqual(await completeRegistration('bukan-token', strong), { ok: false, reason: 'invalid' })
  assert.equal(await prisma.user.count({ where: { email: e } }), 0)
})

await t('akun sudah ada saat tautan diklik (mis. dibuat lewat jalur lain) → exists, transaksi di-rollback, tautan TIDAK terbakar', async () => {
  const e = email(); const token = await pending(e)
  await makeUser(e, { fullName: 'Duluan' })
  assert.deepEqual(await completeRegistration(token, strong), { ok: false, reason: 'exists' })
  assert.ok(await peekToken(token, 'registration'))
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { email: e } })).fullName, 'Duluan') // akun orang lain tidak tertimpa
})

await t('ANTI-PRE-HIJACKING: penyerang mendaftar dengan email korban → tak ada akun/password yang bisa dipegang penyerang', async () => {
  const victim = email()
  const attackerToken = await pending(victim)          // penyerang mengisi form dengan email korban
  assert.equal(await prisma.user.count({ where: { email: victim } }), 0) // tidak ada akun → tak ada password yang bisa dipasang penyerang
  const victimToken = await pending(victim)            // korban (atau penyerang lagi) meminta tautan baru
  assert.deepEqual(await completeRegistration(attackerToken, 'Sandi-Penyerang1!'), { ok: false, reason: 'invalid' })
  assert.equal((await completeRegistration(victimToken, strong)).ok, true) // pemilik email memilih passwordnya sendiri
  const u = await prisma.user.findUniqueOrThrow({ where: { email: victim } })
  assert.equal(await compare(strong, u.passwordHash), true)
  assert.equal(await compare('Sandi-Penyerang1!', u.passwordHash), false)
})

await t('validasi: nama berisi karakter kontrol/tautan/@ ditolak; pendaftaran tanpa persetujuan di form; persetujuan wajib saat menyelesaikan', async () => {
  const base = { email: 'a@example.test', phone: '628111222333', whatsapp: '628111222333' }
  assert.equal(registerSchema.safeParse({ ...base, fullName: 'Budi Santoso' }).success, true)
  for (const bad of ['Budi\nKlik https://x.test', 'Klik https://phish.test', 'budi@evil.test', 'Bud\u0007i']) {
    assert.equal(registerSchema.safeParse({ ...base, fullName: bad }).success, false, bad)
  }
  assert.equal(registerSchema.safeParse({ ...base, fullName: 'Budi', privacyConsent: true }).success, false) // .strict(): tak ada persetujuan di form daftar
  const tok = 'T'.repeat(43)
  assert.equal(completeRegistrationSchema.safeParse({ token: tok, password: strong }).success, false)
  assert.equal(completeRegistrationSchema.safeParse({ token: tok, password: strong, privacyConsent: true }).success, false)
  assert.equal(completeRegistrationSchema.safeParse({ token: tok, password: strong, privacyConsent: true, whatsappConsent: true }).success, true)
})

console.log('== reset password ==')

await t('email tidak ada / akun dinonaktifkan → none (tanpa token); akun aktif → token', async () => {
  assert.deepEqual(await requestPasswordReset(email()), { kind: 'none' })
  const off = email(); await makeUser(off, { isActive: false })
  assert.deepEqual(await requestPasswordReset(off), { kind: 'none' })
  assert.equal(await prisma.authToken.count({ where: { user: { email: off } } }), 0)
  const on = email(); await makeUser(on)
  assert.equal((await requestPasswordReset(on)).kind, 'send')
})

await t('reset: password berganti, tautan sekali pakai, permintaan lebih baru menghanguskan yang lama', async () => {
  const e = email(); const u = await makeUser(e)
  const a = await requestPasswordReset(e); const b = await requestPasswordReset(e)
  assert.equal(a.kind, 'send'); assert.equal(b.kind, 'send')
  const tokenA = (a as { token: string }).token; const tokenB = (b as { token: string }).token
  assert.deepEqual(await resetPassword(tokenA, strong), { ok: false }) // diganti oleh permintaan lebih baru
  assert.equal((await resetPassword(tokenB, strong)).ok, true)
  assert.equal(await compare(strong, (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).passwordHash), true)
  assert.deepEqual(await resetPassword(tokenB, 'Sandi-Lain2!'), { ok: false })
})

await t('balapan reset: dua permintaan bersamaan dengan SATU tautan → tepat satu yang berhasil', async () => {
  const e = email(); await makeUser(e)
  const r = await requestPasswordReset(e) as { token: string }
  const rs = await Promise.all([resetPassword(r.token, strong), resetPassword(r.token, 'Sandi-Lain2!')])
  assert.equal(rs.filter((x) => x.ok).length, 1)
})

await t('reset membuktikan kepemilikan email: akun lama yang belum terverifikasi menjadi terverifikasi', async () => {
  const e = email(); const u = await makeUser(e, { emailVerifiedAt: null })
  const r = await requestPasswordReset(e) as { token: string }
  assert.equal((await resetPassword(r.token, strong)).ok, true)
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt)
})

await t('akun dinonaktifkan SETELAH tautan terbit tidak bisa direset; jenis token tidak tertukar', async () => {
  const e = email(); const u = await makeUser(e)
  const r = await requestPasswordReset(e) as { token: string }
  await prisma.user.update({ where: { id: u.id }, data: { isActive: false } })
  assert.deepEqual(await resetPassword(r.token, strong), { ok: false })
  const reg1 = await pending(email())
  assert.deepEqual(await resetPassword(reg1, strong), { ok: false }) // token pendaftaran tak berlaku sebagai reset
  const uid = (await makeUser(email())).id
  const resetTok = await issueToken({ type: 'password_reset', userId: uid })
  assert.deepEqual(await completeRegistration(resetTok, strong), { ok: false, reason: 'invalid' })
})

console.log('== email auth ==')

function config(opts: { appUrl?: string | null; key?: boolean } = {}) {
  const { appUrl = 'https://saudinesia.test', key = true } = opts
  if (appUrl) env.APP_URL = appUrl; else delete env.APP_URL
  delete env.NEXT_PUBLIC_APP_URL
  if (key) { env.RESEND_API_KEY = 're_test_key'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = `http://127.0.0.1:${mail.port}` }
  else { delete env.RESEND_API_KEY; delete env.RESEND_FROM }
  mailSeen = []; mailStatus = 200
}

await t('email pendaftaran: tautan APP_URL/{locale}/register/complete?token=…, nama ter-escape, tanpa token di subjek', async () => {
  config()
  const r = await sendAuthEmail('registration', 'x@example.test', { name: '<b>Budi</b>', locale: 'id', token: 'T'.repeat(43), whatsappMasked: maskE164('6281234567890') })
  assert.equal(r.status, 'sent')
  assert.equal(mailSeen.length, 1)
  const body = mailSeen[0]!.body as { html: string; text: string; subject: string; to: string[] }
  assert.ok(body.html.includes('https://saudinesia.test/id/register/complete?token=' + 'T'.repeat(43)))
  assert.ok(!body.html.includes('<b>Budi</b>')); assert.ok(body.html.includes('&lt;b&gt;Budi'))
  assert.ok(!body.subject.includes('TTTT'))
  assert.deepEqual(body.to, ['x@example.test'])
  assert.equal(maskE164('6281234567890'), '+62••••••••890'); assert.ok(body.html.includes('+62••••••••890')) // nomor WhatsApp yang didaftarkan ditampilkan SAMAR agar pemilik email mengenali/menolak
  assert.ok(!body.html.includes('6281234567890') && !body.text.includes('6281234567890'))
})

await t('email reset memakai /reset-password; "sudah terdaftar" TANPA tautan sakti', async () => {
  config()
  await sendAuthEmail('password_reset', 'x@example.test', { name: 'Budi', locale: 'en', token: 'R'.repeat(43) })
  assert.ok((mailSeen[0]!.body as { html: string }).html.includes('/en/reset-password?token=' + 'R'.repeat(43)))
  mailSeen = []
  await sendAuthEmail('already_registered', 'x@example.test', { name: 'Budi', locale: 'id' })
  const html = (mailSeen[0]!.body as { html: string }).html
  assert.ok(html.includes('/id/login')); assert.ok(!html.includes('token='))
})

await t('APP_URL kosong (di luar development) → skipped, TIDAK ada request; Resend belum diisi → skipped', async () => {
  config({ appUrl: null })
  assert.equal((await sendAuthEmail('registration', 'x@example.test', { name: 'B', locale: 'id', token: 'T'.repeat(43) })).status, 'skipped')
  assert.equal(mailSeen.length, 0)
  config({ key: false })
  assert.equal((await sendAuthEmail('registration', 'x@example.test', { name: 'B', locale: 'id', token: 'T'.repeat(43) })).status, 'skipped')
})

await t('Resend galat 422 → failed (tidak melempar), tanpa token/alamat di pesan galat', async () => {
  config(); mailStatus = 422
  const r = await sendAuthEmail('registration', 'rahasia@example.test', { name: 'B', locale: 'id', token: 'T'.repeat(43) })
  assert.equal(r.status, 'failed')
  assert.ok(!JSON.stringify(r).includes('TTTT'))
})

await mail.stop()
await prisma.authToken.deleteMany({ where: { OR: [{ email: { startsWith: tag } }, { user: { email: { startsWith: tag } } }] } })
await prisma.consentLog.deleteMany({ where: { user: { email: { startsWith: tag } } } })
await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
