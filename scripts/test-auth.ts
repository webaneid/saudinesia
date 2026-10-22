// Uji lib/auth/{accounts,tokens,authEmail}.ts terhadap DATABASE SUNGGUHAN + Resend PALSU (docs/arsitektur-auth.md §3).
// Fokus keamanan: pendaftaran tidak membuat akun, token hanya hash & sekali pakai, balapan, kedaluwarsa, anti-pre-hijacking.
//
// PENGAMAN: menulis user/token sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { completeRegistration, previewRegistration, requestPasswordReset, requestRegistration, resetPassword } from '@/lib/auth/accounts'
import { hashToken, issueToken, peekToken } from '@/lib/auth/tokens'
import { sendAuthEmail } from '@/lib/auth/authEmail'
import { completeRegistrationSchema, passwordSchema, registerSchema } from '@/lib/validators/auth'
import { SESSION_SAME_SITE, cookieSecure } from '@/lib/auth/cookieFlags'
import { jwtSecretProblem, requireJwtSecret } from '@/lib/auth/secret'
import { signStateCookie } from '@/lib/auth/google'
import { e164FromCountry, maskE164, splitE164 } from '@/lib/utils/phone'
import { isContactComplete, requireContactForBooking, updateContact } from '@/lib/auth/contact'
import { readFileSync } from 'node:fs'
import { contactSchema } from '@/lib/validators/auth'
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

console.log('== kontak (Lengkapi data) ==')

await t('isContactComplete: butuh telepon DAN WhatsApp', () => {
  assert.equal(isContactComplete({ phone: '628111', whatsapp: '628111' }), true)
  assert.equal(isContactComplete({ phone: null, whatsapp: '628111' }), false)
  assert.equal(isContactComplete({ phone: '628111', whatsapp: null }), false)
  assert.equal(isContactComplete({ phone: '', whatsapp: '' }), false)
  return Promise.resolve()
})

await t('e164FromCountry <-> splitE164: nomor Indonesia, luar negeri, kode terpanjang menang, tak dikenal → Indonesia', async () => {
  assert.equal(e164FromCountry('ID', '0812 3456 7890'), '6281234567890')
  assert.equal(e164FromCountry('SA', '055 123 4567'), '966551234567')
  assert.equal(e164FromCountry('ZZ', '812'), '') // negara tak dikenal
  assert.equal(e164FromCountry('ID', ''), '')
  assert.deepEqual(splitE164('6281234567890'), { countryCode: 'ID', local: '81234567890' })
  assert.deepEqual(splitE164('966551234567'), { countryCode: 'SA', local: '551234567' })
  assert.equal(splitE164('12684567890').countryCode, 'AG') // +1268 (Antigua) menang atas +1 (AS)
  assert.deepEqual(splitE164(''), { countryCode: 'ID', local: '' })
  for (const [cc, local] of [['ID', '81234567890'], ['SA', '551234567'], ['MY', '123456789']] as const) {
    const back = splitE164(e164FromCountry(cc, local))
    assert.deepEqual(back, { countryCode: cc, local }, cc) // pulang-pergi (dipakai mengisi ulang form dari data tersimpan)
  }
})

await t('contactSchema: E.164, .strict(); whatsappConsent opsional', async () => {
  assert.equal(contactSchema.safeParse({ phone: '6281234567890', whatsapp: '6281234567890' }).success, true)
  assert.equal(contactSchema.safeParse({ phone: '6281234567890', whatsapp: '6281234567890', whatsappConsent: true }).success, true)
  for (const bad of [{ phone: '1234567890123456', whatsapp: '6281234567890' }, { phone: '62812345678AB', whatsapp: '6281234567890' }, { phone: '6281234567890', whatsapp: '62812 345678' }, { phone: '081234567890', whatsapp: '6281234567890' }, { phone: '+6281234567890', whatsapp: '6281234567890' }, { phone: '6281234567890', whatsapp: '123' }, { phone: '6281234567890' }, { phone: '6281234567890', whatsapp: '6281234567890', role: 'admin' }]) {
    assert.equal(contactSchema.safeParse(bad).success, false, JSON.stringify(bad))
  }
})

await t('updateContact: akun tanpa persetujuan WA → wajib whatsappConsent; dicatat SEKALI; ubah nomor berikutnya tanpa meminta ulang', async () => {
  const u = await makeUser(email())
  const input = { phone: '6281234567890', whatsapp: '6289876543210' }
  assert.deepEqual(await updateContact(u.id, input), { ok: false, reason: 'consent_required' })
  assert.deepEqual(await updateContact(u.id, { ...input, whatsappConsent: false }), { ok: false, reason: 'consent_required' })
  let row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.equal(row.phone, null) // penolakan tidak menyimpan apa pun
  assert.equal((await updateContact(u.id, { ...input, whatsappConsent: true })).ok, true)
  row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } })
  assert.equal(row.phone, input.phone); assert.equal(row.whatsapp, input.whatsapp)
  assert.equal(await prisma.consentLog.count({ where: { userId: u.id, type: 'whatsapp_notifications' } }), 1)
  assert.equal((await updateContact(u.id, { phone: '966551234567', whatsapp: '966551234567' })).ok, true) // tanpa persetujuan baru
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).whatsapp, '966551234567')
  assert.equal((await updateContact(u.id, { ...input, whatsappConsent: true })).ok, true)
  assert.equal(await prisma.consentLog.count({ where: { userId: u.id, type: 'whatsapp_notifications' } }), 1) // tidak dobel
})

await t('BALAPAN: dua updateContact bersamaan dari akun tanpa persetujuan → ConsentLog tepat satu', async () => {
  const u = await makeUser(email())
  const input = { phone: '6281234567890', whatsapp: '6281234567890', whatsappConsent: true }
  const rs = await Promise.all([updateContact(u.id, input), updateContact(u.id, { ...input, phone: '6281111111111' }), updateContact(u.id, input)])
  assert.ok(rs.every((r) => r.ok))
  assert.equal(await prisma.consentLog.count({ where: { userId: u.id, type: 'whatsapp_notifications' } }), 1)
})

await t('updateContact.changed: pengisian pertama BUKAN perubahan; nomor yang sudah ada berganti = changed (pemilik diberi tahu); sama = tidak', async () => {
  const u = await makeUser(email())
  const first = await updateContact(u.id, { phone: '6281234567890', whatsapp: '6281234567890', whatsappConsent: true })
  assert.deepEqual(first, { ok: true, changed: false })
  assert.deepEqual(await updateContact(u.id, { phone: '6281234567890', whatsapp: '6281234567890' }), { ok: true, changed: false })
  assert.deepEqual(await updateContact(u.id, { phone: '6281234567890', whatsapp: '6289999999999' }), { ok: true, changed: true })
  assert.deepEqual(await updateContact(u.id, { phone: '966551234567', whatsapp: '6289999999999' }), { ok: true, changed: true })
})

await t('requireContactForBooking: jamaah tanpa kontak ditolak; lengkap lolos; staf tak terkena; akun tak ada ditolak', async () => {
  const none = await makeUser(email())
  const onlyPhone = await makeUser(email(), { phone: '6281234567890' })
  const full = await makeUser(email(), { phone: '6281234567890', whatsapp: '6281234567890' })
  assert.equal(await requireContactForBooking(none.id, 'pilgrim'), false)
  assert.equal(await requireContactForBooking(onlyPhone.id, 'pilgrim'), false)
  assert.equal(await requireContactForBooking(full.id, 'pilgrim'), true)
  assert.equal(await requireContactForBooking(none.id, 'admin'), true)
  assert.equal(await requireContactForBooking('tidak-ada', 'pilgrim'), false)
})

await t('route POST /bookings memanggil requireContactForBooking SEBELUM membaca body dan SEBELUM efek samping (penjaga tak boleh terhapus diam-diam)', async () => {
  const src = readFileSync(new URL('../app/api/v1/bookings/route.ts', import.meta.url), 'utf8')
  const post = src.slice(src.indexOf('export async function POST'))
  const guard = post.indexOf('requireContactForBooking(')
  assert.ok(guard > 0, 'penjaga hilang dari POST /bookings')
  assert.ok(guard < post.indexOf('request.json()'), 'penjaga harus sebelum membaca body')
  assert.ok(guard < post.indexOf('prisma.$transaction'), 'penjaga harus sebelum transaksi/efek samping')
  assert.match(post, /status: 422/)
})

await t('updateContact: pengguna daftar manual (sudah menyetujui saat menyelesaikan) tidak ditanya lagi; akun tak ada → not_found', async () => {
  const e = email(); const token = await pending(e); await completeRegistration(token, strong)
  const u = await prisma.user.findUniqueOrThrow({ where: { email: e } })
  assert.equal((await updateContact(u.id, { phone: '6281111111111', whatsapp: '6281111111111' })).ok, true)
  assert.deepEqual(await updateContact('tidak-ada', { phone: '6281111111111', whatsapp: '6281111111111', whatsappConsent: true }), { ok: false, reason: 'not_found' })
})

console.log('== penguatan lintas fase ==')

await t('cookie sesi SameSite=LAX (Strict merusak login Google dan tautan dari email), dan penjaga di sumber tak terhapus diam-diam', () => {
  assert.equal(SESSION_SAME_SITE, 'lax')
  const session = readFileSync(new URL('../lib/auth/session.ts', import.meta.url), 'utf8')
  assert.ok(session.includes('sameSite: SESSION_SAME_SITE'), 'session.ts harus memakai SESSION_SAME_SITE')
  assert.ok(!/sameSite:\s*'strict'/i.test(session), "session.ts tak boleh kembali ke 'strict'")
  assert.ok(session.includes('secure: cookieSecure()'))
  const g = readFileSync(new URL('../lib/auth/googleCookies.ts', import.meta.url), 'utf8')
  assert.ok(g.includes('secure: cookieSecure()') && g.includes("sameSite: 'lax'"))
  return Promise.resolve()
})

await t('cookieSecure: Secure aktif di semua lingkungan KECUALI development persis (NODE_ENV salah/kosong tidak melepas Secure)', () => {
  const keep = env.NODE_ENV
  try {
    for (const [nodeEnv, expected] of [['development', false], ['production', true], ['test', true], ['staging', true], ['', true]] as const) {
      env.NODE_ENV = nodeEnv; assert.equal(cookieSecure(), expected, `NODE_ENV="${nodeEnv}"`)
    }
    delete env.NODE_ENV; assert.equal(cookieSecure(), true)
  } finally { env.NODE_ENV = keep }
  return Promise.resolve()
})

await t('JWT_SECRET: kosong, < 32 karakter, berawalan contoh (berapa pun panjangnya), dan entropi rendah ditolak; secret acak diterima — juga oleh kunci turunan cookie Google', async () => {
  const strong = randomBytes(32).toString('hex')
  for (const bad of [undefined, '', 'x'.repeat(31), randomBytes(15).toString('hex'), // 30 karakter acak: hanya cek PANJANG yang menolaknya
     'replace_with_64_char_random_hex', 'REPLACE_WITH_64_CHAR_RANDOM_HEX' + 'a1b2c3d4e5f6', 'changeme' + strong, 'your_secret_' + strong, 'a'.repeat(64), 'ab'.repeat(40), '1234'.repeat(16)]) {
    assert.notEqual(jwtSecretProblem(bad), null, String(bad))
  }
  assert.equal(jwtSecretProblem(strong), null)
  const keep = env.JWT_SECRET
  try {
    env.JWT_SECRET = 'replace_with_64_char_random_hex'
    assert.throws(() => requireJwtSecret(), /contoh|pendek/)
    await assert.rejects(signStateCookie({ state: 's', nonce: 'n', verifier: 'v', locale: 'id' }))
    env.JWT_SECRET = strong
    assert.equal(requireJwtSecret(), strong)
    assert.ok(await signStateCookie({ state: 's', nonce: 'n', verifier: 'v', locale: 'id' }))
  } finally { env.JWT_SECRET = keep }
})

await t('password: batas 72 BYTE (bukan karakter) — ASCII 72 lolos, 73 ditolak, non-ASCII dihitung per byte', () => {
  const base = 'Aa1!'
  assert.equal(passwordSchema.safeParse(base + 'x'.repeat(68)).success, true)   // 72 byte
  assert.equal(passwordSchema.safeParse(base + 'x'.repeat(69)).success, false)  // 73 byte
  assert.equal(passwordSchema.safeParse(base + '€'.repeat(22)).success, true)   // 4 + 66 = 70 byte
  assert.equal(passwordSchema.safeParse(base + '€'.repeat(24)).success, false)  // 28 karakter tetapi 76 byte → tak boleh terpotong diam-diam
  return Promise.resolve()
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

await t('DEV: email gagal/ditolak (kunci placeholder) → tautan tetap dicetak ke LOG SERVER; di luar development TIDAK pernah dicetak', async () => {
  const printed: string[] = []; const origLog = console.log; const origErr = console.error
  console.log = (...a: unknown[]) => { printed.push(a.join(' ')) }; console.error = () => {}
  const run = async (nodeEnv: string, status: number) => {
    config(); mailStatus = status; env.NODE_ENV = nodeEnv; printed.length = 0
    await sendAuthEmail('registration', 'x@example.test', { name: 'B', locale: 'id', token: 'T'.repeat(43) })
    return printed.join('\n')
  }
  try {
    const failed401 = await run('development', 401)
    assert.ok(failed401.includes('?token=' + 'T'.repeat(43)), 'dev + Resend menolak (401) → tautan harus dicetak')
    config({ key: false }); env.NODE_ENV = 'development'; printed.length = 0
    await sendAuthEmail('registration', 'x@example.test', { name: 'B', locale: 'id', token: 'T'.repeat(43) })
    assert.ok(printed.join('').includes('?token='), 'dev + Resend belum dikonfigurasi → tautan dicetak')
    assert.ok(!(await run('development', 200)).includes('?token='), 'email terkirim → tautan TIDAK dicetak')
    for (const prod of ['production', 'test', 'staging', '']) assert.ok(!(await run(prod, 401)).includes('?token='), `NODE_ENV="${prod}" tak boleh mencetak tautan`)
  } finally { console.log = origLog; console.error = origErr; env.NODE_ENV = 'test' }
})

await mail.stop()
await prisma.authToken.deleteMany({ where: { OR: [{ email: { startsWith: tag } }, { user: { email: { startsWith: tag } } }] } })
await prisma.consentLog.deleteMany({ where: { user: { email: { startsWith: tag } } } })
await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
