// Tambah Pelanggan oleh admin (docs/arsitektur-pelanggan.md §6): createCustomer / inviteCustomer terhadap DATABASE SUNGGUHAN + server Resend palsu + penjaga sumber.
// Dibuktikan: akun lahir belum diaktifkan (tanpa password yang dikenal, tanpa verifikasi, tanpa persetujuan), tak bisa login; email unik (409, juga saat balapan), huruf besar dinormalisasi;
// alamat divalidasi dan tak ada baris yatim saat gagal; undangan: umur 7 hari, hanya hash tersimpan, tautan lama hangus, tautan DI EMAIL benar-benar mengaktifkan akun lewat reset-password
// (email terverifikasi, sesi lama mati, bisa login) dan gerbang persetujuan baru menahan jamaah sampai ia menyetujui sendiri; skema `.strict()` menolak role/password/dll; route berotorisasi dan berbatas laju.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compare } from 'bcryptjs'
import { prisma } from '@/lib/db'
import { createCustomer, inviteCustomer } from '@/lib/customers/create'
import { canManageCustomers } from '@/lib/customers/policy'
import { customerCreateSchema } from '@/lib/validators/customers'
import { resetPassword } from '@/lib/auth/accounts'
import { INVITATION_TTL_MS, hashToken } from '@/lib/auth/tokens'
import { getOnboardingState, isOnboardingComplete, requireContactForBooking, updateContact } from '@/lib/auth/contact'
import { authEmailContent } from '@/lib/email/authTemplates'
import { LIMITS } from '@/lib/auth/rateLimit'
import { startFakeServer, type FakeRequest } from './lib/fakeServer'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()
const env = process.env as Record<string, string | undefined>
env.NODE_ENV = 'test'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (f: string) => readFileSync(join(root, f), 'utf8')

let mails: FakeRequest[] = []
const resend = await startFakeServer(req => { mails.push(req); return { status: 200, body: { id: 'msg_inv' } } })
env.RESEND_API_KEY = 're_test_secret_key_123'; env.RESEND_FROM = 'Saudinesia <noreply@saudinesia.test>'; env.RESEND_API_URL = `http://127.0.0.1:${resend.port}`; env.APP_URL = 'https://saudinesia.test'

const tag = `cc${Date.now().toString(36)}`
const emails: string[] = []
const mk = (key: string) => { const e = `${tag}-${key}@example.test`; emails.push(e); return e }
const parse = (o: Record<string, unknown>) => customerCreateSchema.parse({ fullName: 'Budi Santoso', email: mk('x'), ...o })

await t('createCustomer: akun lahir BELUM DIAKTIFKAN — pilgrim, aktif, email belum terverifikasi, tanpa persetujuan; kontak tersimpan; password acak tak dikenal (dua akun beda hash, tak cocok dengan tebakan umum)', async () => {
  const email = mk('a')
  const r = await createCustomer(parse({ email, phone: '6281234567890', whatsapp: '6281234567890' }))
  assert.ok(r.ok); if (!r.ok) return
  const u = await prisma.user.findUniqueOrThrow({ where: { id: r.id }, include: { consentLogs: true } })
  assert.deepEqual([u.role, u.isActive, u.emailVerifiedAt, u.phone, u.whatsapp, u.consentLogs.length, u.whatsappVerifiedAt], ['pilgrim', true, null, '6281234567890', '6281234567890', 0, null])
  const r2 = await createCustomer(parse({ email: mk('b') }))
  assert.ok(r2.ok); if (!r2.ok) return
  const u2 = await prisma.user.findUniqueOrThrow({ where: { id: r2.id } })
  assert.notEqual(u.passwordHash, u2.passwordHash)
  for (const guess of ['', 'password', 'Password1!', 'admin', email, 'Budi Santoso']) assert.equal(await compare(guess, u.passwordHash), false, `tebakan "${guess}" tak boleh cocok`)
  assert.match(u.passwordHash, /^\$2[aby]\$12\$/, 'bcrypt cost 12')
})
await t('login ditolak untuk akun belum diaktifkan: rute login mensyaratkan emailVerifiedAt (akun buatan admin tak bisa dimasuki sebelum pemiliknya membuat password)', () => {
  const src = read('app/api/v1/auth/login/route.ts')
  assert.match(src, /!user\.emailVerifiedAt/)
})
await t('email: huruf besar dinormalisasi; duplikat → 409 (juga beda huruf); email akun lain (termasuk staf) tak bisa dipakai ulang', async () => {
  const lower = mk('c')
  const parsed = parse({ email: lower.toUpperCase() })
  assert.equal(parsed.email, lower)
  assert.ok((await createCustomer(parsed)).ok)
  const dup = await createCustomer(parse({ email: lower.toUpperCase() }))
  assert.deepEqual(dup.ok ? null : [dup.status, dup.message], [409, 'Email ini sudah terdaftar sebagai akun.'])
  const staff = await prisma.user.create({ data: { email: mk('staf'), passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
  assert.equal((await createCustomer(parse({ email: staff.email }))).ok, false)
})
await t('BALAPAN: lima admin menambah email yang sama bersamaan → TEPAT satu berhasil, sisanya 409, hanya satu baris akun', async () => {
  const email = mk('race')
  const rs = await Promise.all(Array.from({ length: 5 }, () => createCustomer(parse({ email, address: { type: 'international', fullAddress: '1 Race St', countryCode: 'SG', city: 'Singapore' } }))))
  assert.equal(rs.filter(r => r.ok).length, 1)
  assert.ok(rs.filter(r => !r.ok).every(r => !r.ok && r.status === 409))
  assert.equal(await prisma.user.count({ where: { email } }), 1)
})
await t('alamat: domestik/internasional tersimpan dan terhubung; hierarki wilayah salah → 400 tanpa membuat akun dan tanpa baris alamat yatim; tanpa alamat → addressId null', async () => {
  const intl = await createCustomer(parse({ email: mk('intl'), address: { type: 'international', fullAddress: '12 Orchard Rd', countryCode: 'SG', city: 'Singapore' } }))
  assert.ok(intl.ok); if (!intl.ok) return
  const u = await prisma.user.findUniqueOrThrow({ where: { id: intl.id }, include: { address: true } })
  assert.deepEqual([u.address?.type, u.address?.countryCode, u.address?.fullAddress], ['international', 'SG', '12 Orchard Rd'])
  const before = await prisma.address.count()
  const bad = await createCustomer(parse({ email: mk('bad'), address: { type: 'domestic', fullAddress: 'Jl. X', provinceId: 'tak-ada', regencyId: 'tak-ada-juga' } }))
  assert.deepEqual(bad.ok ? null : bad.status, 400)
  assert.equal(await prisma.address.count(), before, 'tak ada alamat yatim')
  assert.equal(await prisma.user.count({ where: { email: `${tag}-bad@example.test` } }), 0)
  const onlyProv = await createCustomer(parse({ email: mk('prov'), address: { type: 'domestic', fullAddress: 'Jl. Y', provinceId: 'tak-ada' } }))
  assert.deepEqual(onlyProv.ok ? null : onlyProv.status, 400, 'provinsi yang tak ada ditolak walau tanpa kabupaten')
  assert.equal(await prisma.address.count(), before, 'tak ada alamat yatim (provinsi)')
  const none = await createCustomer(parse({ email: mk('none') }))
  assert.ok(none.ok && (await prisma.user.findUniqueOrThrow({ where: { id: none.id } })).addressId === null)
})

console.log('== undangan ==')
await t('inviteCustomer: token password_reset berumur 7 hari, HANYA hash tersimpan, email terkirim ke alamat pelanggan dengan tautan reset-password; undangan baru menghanguskan yang lama', async () => {
  const email = mk('inv')
  const r = await createCustomer(parse({ email }))
  assert.ok(r.ok); if (!r.ok) return
  mails = []
  assert.deepEqual(await inviteCustomer(r.id), { ok: true, status: 'sent' })
  assert.equal(mails.length, 1)
  const mail = mails[0]!.body as { to: string[]; subject: string; html: string; text: string }
  assert.deepEqual(mail.to, [email])
  assert.match(mail.subject, /Akun Saudinesia Anda sudah dibuatkan/)
  const link = /https:\/\/saudinesia\.test\/id\/reset-password\?token=([A-Za-z0-9_-]{43})/.exec(mail.text)
  assert.ok(link, 'tautan di teks email'); const raw = link![1]!
  const row = await prisma.authToken.findUniqueOrThrow({ where: { tokenHash: hashToken(raw) } })
  assert.deepEqual([row.type, row.userId, row.usedAt], ['password_reset', r.id, null])
  const ttl = row.expiresAt.getTime() - Date.now()
  assert.ok(Math.abs(ttl - INVITATION_TTL_MS) < 60_000, `umur ${ttl} ms`)
  assert.equal(await prisma.authToken.count({ where: { tokenHash: raw } }), 0, 'token mentah tak pernah disimpan')
  // undangan kedua → tautan pertama hangus
  mails = []
  assert.deepEqual(await inviteCustomer(r.id), { ok: true, status: 'sent' })
  assert.equal(await prisma.authToken.count({ where: { userId: r.id, type: 'password_reset', usedAt: null } }), 1)
  assert.equal(await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) } }), null)
  assert.equal(await resetPassword(raw, 'Sandi-Kuat1!').then(x => x.ok), false, 'tautan lama tak berlaku')
})
await t('AKTIVASI end-to-end: tautan dari email → resetPassword mengaktifkan akun (email terverifikasi, password baru, sesi lama mati); tautan sekali pakai; setelah itu akun punya password nyata', async () => {
  const r = await createCustomer(parse({ email: mk('act'), phone: '6281234567890', whatsapp: '6281234567890' }))
  assert.ok(r.ok); if (!r.ok) return
  mails = []; await inviteCustomer(r.id)
  const raw = /token=([A-Za-z0-9_-]{43})/.exec((mails[0]!.body as { text: string }).text)![1]!
  const before = await prisma.user.findUniqueOrThrow({ where: { id: r.id } })
  assert.deepEqual(await resetPassword(raw, 'Sandi-Kuat1!').then(x => x.ok), true)
  const after = await prisma.user.findUniqueOrThrow({ where: { id: r.id } })
  assert.ok(after.emailVerifiedAt, 'email terverifikasi oleh tautan')
  assert.equal(after.sessionVersion, before.sessionVersion + 1)
  assert.equal(await compare('Sandi-Kuat1!', after.passwordHash), true)
  assert.equal(await resetPassword(raw, 'Lain-Lagi-1!').then(x => x.ok), false, 'sekali pakai')
  assert.equal(await inviteCustomer(r.id).then(x => (x.ok ? 'ok' : x.status)), 409, 'sudah aktif: tak bisa diundang lagi')
})
await t('tautan undangan kedaluwarsa setelah 7 hari (bukan 30 menit); sebelum itu masih berlaku', async () => {
  const r = await createCustomer(parse({ email: mk('exp') }))
  assert.ok(r.ok); if (!r.ok) return
  mails = []; await inviteCustomer(r.id)
  const raw = /token=([A-Za-z0-9_-]{43})/.exec((mails[0]!.body as { text: string }).text)![1]!
  await prisma.authToken.update({ where: { tokenHash: hashToken(raw) }, data: { expiresAt: new Date(Date.now() + 3_600_000) } })
  const { peekToken } = await import('@/lib/auth/tokens')
  assert.ok(await peekToken(raw, 'password_reset'), 'sehari sebelum habis masih berlaku')
  await prisma.authToken.update({ where: { tokenHash: hashToken(raw) }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.equal(await peekToken(raw, 'password_reset'), null)
})
await t('inviteCustomer menolak: akun tak ada/staf (404), nonaktif (409), sudah dihapus-anonim (409), sudah aktif (409); layanan email mati → status skipped (akun tetap ada)', async () => {
  assert.deepEqual(await inviteCustomer('tak-ada'), { ok: false, status: 404, message: 'Pelanggan tidak ditemukan.' })
  const staff = await prisma.user.create({ data: { email: mk('s2'), passwordHash: 'x', fullName: 'Staf', role: 'admin', isActive: true } })
  assert.equal((await inviteCustomer(staff.id)).ok, false)
  const off = await prisma.user.create({ data: { email: mk('off'), passwordHash: 'x', fullName: 'Off', role: 'pilgrim', isActive: false } })
  assert.deepEqual(await inviteCustomer(off.id).then(x => (x.ok ? 0 : x.status)), 409)
  const gone = await prisma.user.create({ data: { email: `deleted-${tag}@deleted.invalid`, passwordHash: 'x', fullName: 'Akun Dihapus', role: 'pilgrim', isActive: false } })
  emails.push(gone.email)
  assert.deepEqual(await inviteCustomer(gone.id).then(x => (x.ok ? 0 : x.status)), 409)
  const r = await createCustomer(parse({ email: mk('mati') }))
  assert.ok(r.ok); if (!r.ok) return
  const saved = env.RESEND_API_KEY; delete env.RESEND_API_KEY
  try { assert.deepEqual(await inviteCustomer(r.id), { ok: true, status: 'skipped' }) } finally { env.RESEND_API_KEY = saved }
})

console.log('== gerbang persetujuan ==')
await t('akun buatan admin: kontak lengkap TAPI belum ada persetujuan → gerbang menahan dan booking ditolak di server; jamaah menyetujui sendiri (privasi + WhatsApp) → lengkap; persetujuan sekali cukup', async () => {
  const r = await createCustomer(parse({ email: mk('gate'), phone: '6281234567890', whatsapp: '6281234567890' }))
  assert.ok(r.ok); if (!r.ok) return
  const s0 = (await getOnboardingState(r.id))!
  assert.deepEqual([s0.contactComplete, s0.whatsappConsent, s0.privacyConsent, isOnboardingComplete(s0)], [true, false, false, false])
  assert.equal(await requireContactForBooking(r.id, 'pilgrim'), false)
  assert.equal((await updateContact(r.id, { phone: '6281234567890', whatsapp: '6281234567890' })).ok, false, 'WhatsApp tetap butuh persetujuan eksplisit')
  assert.equal((await updateContact(r.id, { phone: '6281234567890', whatsapp: '6281234567890', whatsappConsent: true })).ok, true)
  const s1 = (await getOnboardingState(r.id))!
  assert.deepEqual([s1.whatsappConsent, s1.privacyConsent, isOnboardingComplete(s1)], [true, false, false], 'persetujuan WhatsApp saja belum cukup — privasi juga wajib')
  assert.equal(await requireContactForBooking(r.id, 'pilgrim'), false)
  // 5 PUT paralel yang sama-sama membawa persetujuan privasi → tepat satu catatan (dicatat di transaksi terkunci yang sama dengan kontak)
  const par = await Promise.all(Array.from({ length: 5 }, () => updateContact(r.id, { phone: '6281234567890', whatsapp: '6281234567890', privacyConsent: true })))
  assert.ok(par.every(x => x.ok))
  assert.equal(await prisma.consentLog.count({ where: { userId: r.id, type: 'privacy_policy' } }), 1, 'idempoten & tak ganda saat paralel')
  assert.equal(await requireContactForBooking(r.id, 'pilgrim'), true)
  assert.equal(isOnboardingComplete((await getOnboardingState(r.id))!), true)
})
await t('rute kontak: privasi diperiksa SEBELUM menyimpan apa pun dan dicatat hanya atas tindakan pemilik; layout jamaah dan halaman Lengkapi data memakai gerbang yang sama', () => {
  const route = read('app/api/v1/auth/contact/route.ts')
  assert.match(route, /!state\.privacyConsent && privacyConsent !== true\) return NextResponse\.json\(err\('Anda harus menyetujui Kebijakan Privasi\.'\), \{ status: 400 \}\)/)
  assert.ok(route.indexOf('privacyConsent !== true') < route.indexOf('updateContact(session.userId'), 'cek privasi sebelum updateContact')
  assert.doesNotMatch(route, /ensurePrivacyConsent/, 'persetujuan dicatat atomik di updateContact, bukan pemanggilan terpisah')
  assert.match(route, /updateContact\(session\.userId, parsed\.data\)/)
  assert.match(read('app/[locale]/(pilgrim)/layout.tsx'), /isOnboardingComplete\(state\)/)
  assert.match(read('app/[locale]/(auth)/lengkapi-data/page.tsx'), /isOnboardingComplete\(state\)/)
})

console.log('== audit SEC-105 ==')
await t('batas panjang alamat ditolak skema; rute undangan memeriksa kelayakan SEBELUM menghabiskan kuota email; login Google atas akun belum diaktifkan menghanguskan tautan undangan', () => {
  const long = (o: object) => customerCreateSchema.safeParse({ fullName: 'Budi', email: mk('len'), address: { type: 'international', fullAddress: 'x', countryCode: 'SG', ...o } }).success
  assert.equal(long({}), true)
  assert.equal(long({ fullAddress: 'x'.repeat(501) }), false)
  assert.equal(long({ postalCode: '1'.repeat(21) }), false)
  assert.equal(long({ city: 'x'.repeat(101) }), false)
  assert.equal(long({ stateRegion: 'x'.repeat(101) }), false)
  const route = read('app/api/v1/admin/customers/[id]/invite/route.ts')
  assert.ok(route.indexOf('findInvitable(') > 0 && route.indexOf('findInvitable(') < route.indexOf("consume(policy('authEmailSendEmail'"), 'kelayakan sebelum kuota email')
  assert.ok(route.indexOf("consume(policy('authEmailSendEmail'") < route.indexOf('sendInvitation('), 'kuota sebelum kirim')
  assert.match(read('lib/auth/googleAccounts.ts'), /legacyUnverified\) await prisma\.authToken\.deleteMany\(\{ where: \{ userId: byEmail\.id, type: 'password_reset', usedAt: null \}/)
})

console.log('== skema, rute, kebijakan ==')
await t('skema .strict(): role/isActive/passwordHash/emailVerifiedAt/id dan kolom liar DITOLAK; email/nama/nomor tak valid ditolak; sendInvite bawaan true', () => {
  const ok = { fullName: 'Budi', email: 'budi@example.test' }
  assert.equal(customerCreateSchema.parse(ok).sendInvite, true)
  for (const extra of [{ role: 'superadmin' }, { isActive: false }, { passwordHash: 'x' }, { password: 'Abcdef1!' }, { emailVerifiedAt: '2026-01-01' }, { id: 'x' }, { sessionVersion: 9 }, { liar: 1 }]) {
    assert.equal(customerCreateSchema.safeParse({ ...ok, ...extra }).success, false, JSON.stringify(extra))
  }
  for (const bad of [{ fullName: 'B' }, { email: 'bukan-email' }, { phone: '0812' }, { whatsapp: 'abc' }, { phone: '081234567890' }]) assert.equal(customerCreateSchema.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad))
  assert.equal(customerCreateSchema.safeParse({ ...ok, phone: null, whatsapp: null, address: null }).success, true)
})
await t('rute: guard requireCustomerManage di baris pertama, batas laju per admin (+ per alamat untuk undangan), skema strict, tanpa body mentah ke Prisma, tanpa token di respons; semua peran admin boleh, jamaah tidak', () => {
  for (const f of ['app/api/v1/admin/customers/route.ts', 'app/api/v1/admin/customers/[id]/invite/route.ts']) {
    const src = read(f)
    assert.ok(src.indexOf('requireCustomerManage()') > 0 && src.indexOf('requireCustomerManage()') < Math.min(...['consume(', 'safeParse(', 'prisma.'].map(k => (src.indexOf(k) < 0 ? Infinity : src.indexOf(k)))), f)
    assert.match(src, /authFailureResponse\(/); assert.doesNotMatch(src, /data:\s*(body|b)\b|\.\.\.body/)
    assert.doesNotMatch(src, /ok\(\{[^}]*token/i, `${f}: token tak boleh keluar di respons`)
  }
  assert.match(read('app/api/v1/admin/customers/route.ts'), /policy\('customerCreateAdmin'/)
  assert.match(read('app/api/v1/admin/customers/route.ts'), /policy\('customerInviteAdmin'/)
  assert.match(read('app/api/v1/admin/customers/[id]/invite/route.ts'), /policy\('authEmailSendEmail'/)
  assert.deepEqual([canManageCustomers('admin'), canManageCustomers('manager'), canManageCustomers('superadmin'), canManageCustomers('pilgrim')], [true, true, true, false])
  assert.ok(LIMITS.customerCreateAdmin.limit > 0 && LIMITS.customerInviteAdmin.limit > 0)
})
await t('templat undangan: menyebut 7 hari + tautan reset-password bertoken; tanpa HPP/angka internal; nama di-escape', () => {
  const c = authEmailContent('account_invitation', { name: '<b>Budi</b>', locale: 'id', token: 'T'.repeat(43) })
  assert.match(c.text, /7 hari/); assert.match(c.text, /\/id\/reset-password\?token=T{43}/)
  assert.ok(!c.html.includes('<b>Budi</b>'), 'nama di-escape')
})
await t('halaman: formulir memakai CreatePage + ContactPicker + AddressPicker; daftar punya tombol Tambah; detail menawarkan kirim ulang hanya untuk akun belum aktif', () => {
  const page = read('app/[locale]/admin/(protected)/customers/new/page.tsx')
  assert.match(page, /<CreatePage/); assert.match(page, /<ContactPicker/); assert.match(page, /<AddressPicker/)
  assert.doesNotMatch(page, /type="password"|passwordHash/, 'admin tak pernah memasukkan password')
  assert.match(read('app/[locale]/admin/(protected)/customers/page.tsx'), /customers\/new/)
  assert.match(read('app/[locale]/admin/(protected)/customers/[id]/page.tsx'), /!c\.emailVerified && c\.isActive/)
})

// ── pembersihan ──────────────────────────────────────────────────────────────────────────────────────────────────────
const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, addressId: true } })
await prisma.authToken.deleteMany({ where: { userId: { in: users.map(u => u.id) } } })
await prisma.consentLog.deleteMany({ where: { userId: { in: users.map(u => u.id) } } })
await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } })
await prisma.address.deleteMany({ where: { id: { in: users.flatMap(u => (u.addressId ? [u.addressId] : [])) } } })
await resend.stop()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
