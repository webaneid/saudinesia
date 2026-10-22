// Uji pencabutan sesi (SEC-18, docs/arsitektur-auth.md §11) terhadap DATABASE SUNGGUHAN.
// Inti: JWT yang tanda tangan & kedaluwarsanya valid TIDAK cukup — akun harus masih aktif, terverifikasi, versi sesi cocok, dan peran dari DB.
//
// PENGAMAN: menulis user sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'
import { prisma } from '@/lib/db'
import { issueSessionToken, resolveSessionToken } from '@/lib/auth/session'
import { resetPassword } from '@/lib/auth/accounts'
import { issueToken } from '@/lib/auth/tokens'
import { resolveGoogleLogin } from '@/lib/auth/googleAccounts'
import { updateUserByAdmin } from '@/lib/auth/adminUsers'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

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
env.JWT_SECRET = randomBytes(32).toString('hex')

const tag = `ss${Date.now()}`
let n = 0
const mk = (extra: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: { email: `${tag}-${++n}@example.test`, passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012', fullName: 'Uji Sesi', role: 'pilgrim', isActive: true, emailVerifiedAt: new Date(), ...extra },
  })
const secret = () => new TextEncoder().encode(env.JWT_SECRET)

console.log('== validasi token ke DB ==')

await t('kontrol positif: token baru untuk akun sah → sesi; peran dari DB', async () => {
  const u = await mk({ role: 'admin' })
  assert.deepEqual(await resolveSessionToken(await issueSessionToken(u.id)), { userId: u.id, role: 'admin' })
})

await t('tanpa token / sampah / ditandatangani rahasia lain → null', async () => {
  const u = await mk()
  assert.equal(await resolveSessionToken(undefined), null)
  assert.equal(await resolveSessionToken('bukan.jwt.sama-sekali'), null)
  const foreign = await new SignJWT({ userId: u.id, role: 'pilgrim', ver: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(randomBytes(32).toString('hex')))
  assert.equal(await resolveSessionToken(foreign), null)
})

await t('token lama tanpa `ver` (terbit sebelum fitur ini) → ditolak (fail-closed); `ver` bukan angka → ditolak', async () => {
  const u = await mk()
  const legacy = await new SignJWT({ userId: u.id, role: 'pilgrim' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret())
  assert.equal(await resolveSessionToken(legacy), null)
  const str = await new SignJWT({ userId: u.id, role: 'pilgrim', ver: '0' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret())
  assert.equal(await resolveSessionToken(str), null)
  // kontrol positif: bentuk yang sama dengan ver numerik benar → lolos
  const ok = await new SignJWT({ userId: u.id, role: 'pilgrim', ver: 0 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(secret())
  assert.ok(await resolveSessionToken(ok))
})

await t('akun dihapus → token valid ditolak; akun belum terverifikasi emailnya → ditolak', async () => {
  const gone = await mk(); const tokG = await issueSessionToken(gone.id)
  await prisma.user.delete({ where: { id: gone.id } })
  assert.equal(await resolveSessionToken(tokG), null)
  const u = await mk(); const tok = await issueSessionToken(u.id)
  await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: null } })
  assert.equal(await resolveSessionToken(tok), null)
  await assert.rejects(issueSessionToken(u.id)) // juga tak bisa menerbitkan token baru
})

await t('isActive dimatikan LANGSUNG di DB (tanpa menaikkan versi — SQL manual / kode masa depan) → token tetap ditolak', async () => {
  const u = await mk(); const tok = await issueSessionToken(u.id)
  assert.ok(await resolveSessionToken(tok))
  await prisma.user.update({ where: { id: u.id }, data: { isActive: false } })
  assert.equal(await resolveSessionToken(tok), null)
})

await t('peran DIBACA DARI DB, bukan dari token: staf diturunkan → seketika bukan admin walau JWT masih berklaim admin', async () => {
  const u = await mk({ role: 'superadmin' }); const tok = await issueSessionToken(u.id)
  assert.equal((await resolveSessionToken(tok))?.role, 'superadmin')
  await prisma.user.update({ where: { id: u.id }, data: { role: 'pilgrim' } }) // sengaja tanpa menaikkan versi: buktikan peran bukan dari token
  assert.equal((await resolveSessionToken(tok))?.role, 'pilgrim')
})

console.log('== pencabutan ==')

await t('nonaktif → token ditolak SEKETIKA; diaktifkan kembali lewat admin → token LAMA tetap mati, token baru jalan', async () => {
  const u = await mk({ role: 'admin' }); const old = await issueSessionToken(u.id)
  assert.ok(await resolveSessionToken(old))
  await updateUserByAdmin(u.id, { isActive: false })
  assert.equal(await resolveSessionToken(old), null)
  await updateUserByAdmin(u.id, { isActive: true })
  assert.equal(await resolveSessionToken(old), null, 'token lama tidak boleh hidup lagi setelah reaktivasi')
  assert.ok(await resolveSessionToken(await issueSessionToken(u.id)))
})

await t('perubahan peran lewat admin → sesi lama dicabut; permintaan yang tidak mengubah apa pun TIDAK menendang', async () => {
  const u = await mk({ role: 'admin' }); const tok = await issueSessionToken(u.id)
  await updateUserByAdmin(u.id, { role: 'admin', isActive: true }) // sama persis dengan keadaan sekarang
  assert.ok(await resolveSessionToken(tok), 'no-op tidak boleh mencabut sesi')
  await updateUserByAdmin(u.id, { role: 'manager' })
  assert.equal(await resolveSessionToken(tok), null)
  assert.equal((await resolveSessionToken(await issueSessionToken(u.id)))?.role, 'manager')
})

await t('updateUserByAdmin: id tak ada → null; nonaktif melepas nomor WhatsApp terverifikasi', async () => {
  assert.equal(await updateUserByAdmin('00000000-0000-0000-0000-000000000000', { isActive: false }), null)
  const num = `62${Math.floor(8e9 + Math.random() * 1e9)}`
  const u = await mk({ whatsapp: num, whatsappVerifiedAt: new Date(), verifiedWhatsapp: num })
  await updateUserByAdmin(u.id, { isActive: false })
  const after = await prisma.user.findUnique({ where: { id: u.id } })
  assert.equal(after?.verifiedWhatsapp, null); assert.equal(after?.whatsappVerifiedAt, null)
})

await t('reset password → sesi LAMA (mis. dicuri penyerang) mati; sesi baru setelah reset berlaku', async () => {
  const u = await mk(); const stolen = await issueSessionToken(u.id)
  assert.ok(await resolveSessionToken(stolen))
  const raw = await issueToken({ type: 'password_reset', userId: u.id })
  const res = await resetPassword(raw, 'Sandi-Baru-123!')
  assert.equal(res.ok, true)
  assert.equal(await resolveSessionToken(stolen), null)
  assert.ok(await resolveSessionToken(await issueSessionToken(u.id)))
})

await t('menyambung Google ke akun LAMA belum terverifikasi → password lama dibuang DAN sesi lamanya dicabut', async () => {
  const u = await mk(); const old = await issueSessionToken(u.id)
  await prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: null } }) // keadaan akun pra-verifikasi
  const r = await resolveGoogleLogin({ sub: `sub-${tag}`, email: u.email, name: 'X' })
  assert.equal(r.kind, 'session')
  // emailVerifiedAt kini terisi (Google membuktikan email) — tanpa kenaikan versi token lama akan HIDUP LAGI
  assert.equal(await resolveSessionToken(old), null)
  assert.ok(await resolveSessionToken(await issueSessionToken(u.id)))
})

await t('menyambung Google ke akun TERVERIFIKASI → sesi yang ada tidak dicabut (tak ada alasan menendang pemilik sah)', async () => {
  const u = await mk(); const tok = await issueSessionToken(u.id)
  const r = await resolveGoogleLogin({ sub: `sub2-${tag}`, email: u.email, name: 'X' })
  assert.equal(r.kind, 'session')
  assert.ok(await resolveSessionToken(tok))
})

await t('login-vs-reset (S18-B): token dengan versi yang dilihat SEBELUM reset ditolak; versi yang cocok lolos', async () => {
  const u = await mk()
  assert.ok(await issueSessionToken(u.id, 0), 'kontrol positif: versi cocok')
  await prisma.user.update({ where: { id: u.id }, data: { sessionVersion: { increment: 1 } } }) // reset commit di celah bcrypt
  await assert.rejects(issueSessionToken(u.id, 0), /Unauthorized/)
  assert.ok(await issueSessionToken(u.id, 1))
  assert.ok(await issueSessionToken(u.id), 'tanpa expectedVersion (jalur lain) tetap membaca versi terkini')
})

await t('algoritma: token HS512 bertanda tangan rahasia BENAR ditolak (hanya HS256); kontrol positif HS256 lolos', async () => {
  const u = await mk()
  const mkTok = (alg: string) => new SignJWT({ userId: u.id, role: 'pilgrim', ver: 0 }).setProtectedHeader({ alg }).setExpirationTime('1h').sign(secret())
  assert.ok(await resolveSessionToken(await mkTok('HS256')))
  assert.equal(await resolveSessionToken(await mkTok('HS512')), null)
})

await t('updateUserByAdmin bersamaan (S18-C): dua permintaan paralel pada akun yang sama berserial — tak ada pembaruan hilang', async () => {
  const u = await mk({ role: 'admin' }); const tok = await issueSessionToken(u.id)
  // A menonaktifkan, B mengirim isActive:true. Apa pun urutannya, hasil akhirnya salah satu dari dua keadaan konsisten
  // DAN token lama mati (setidaknya satu perubahan nyata terjadi → versi naik).
  await Promise.all([updateUserByAdmin(u.id, { isActive: false }), updateUserByAdmin(u.id, { isActive: true })])
  assert.equal(await resolveSessionToken(tok), null)
  const row = await prisma.user.findUnique({ where: { id: u.id }, select: { sessionVersion: true } })
  assert.ok((row?.sessionVersion ?? 0) >= 1)
})

console.log('== penjaga sumber ==')

await t('setiap penulis User yang mengubah password/peran/status/kepemilikan menaikkan sessionVersion di write yang SAMA (dipindai; allowlist eksplisit)', async () => {
  const { execSync } = await import('node:child_process')
  const files = execSync(`grep -rlE "(prisma|tx)\\.user\\.(update|updateMany|upsert)\\(" app lib prisma scripts --include='*.ts' --include='*.tsx' | grep -v "scripts/test-" || true`).toString().trim().split('\n').filter(Boolean)
  assert.ok(files.length >= 5, `pemindai tak menemukan penulis User (${files.length}) — penjaga ini tak bermakna`)
  // Hanya field yang MEMBUTUHKAN pencabutan sesi. phone/whatsapp/nama/alamat tidak.
  const SENSITIVE = /\b(passwordHash|role|isActive|googleSub|emailVerifiedAt)\b\s*[:,}]/
  // Penjelasan wajib untuk tiap pengecualian. seed.ts = dev-only (SEC-27); bukan jalur produksi.
  const ALLOW: Record<string, string> = { 'prisma/seed.ts': 'seed pengembangan, SEC-27' }
  const bad: string[] = []
  for (const f of files) {
    if (ALLOW[f]) continue
    const src = readFileSync(f, 'utf8')
    for (const m of src.matchAll(/(?:prisma|tx)\.user\.(?:update|updateMany|upsert)\(/g)) {
      // Buang komentar dan blok select/where: `select: { role: true }` adalah pembacaan, bukan penulisan field sensitif.
      const slice = src.slice(m.index!, m.index! + 900).replace(/\/\/[^\n]*/g, '').replace(/(select|where):\s*\{[^}]*\}/g, '') // komentar juga dibuang: kata "sessionVersion" di komentar bukan bukti
      if (SENSITIVE.test(slice) && !/sessionVersion/.test(slice)) bad.push(`${f}@${m.index}`)
    }
  }
  assert.deepEqual(bad, [], 'penulis User mengubah field sensitif tanpa menaikkan sessionVersion')
})

await t('setiap halaman admin Server Component yang memakai Prisma memanggil penjaga halaman (layout tidak dirender ulang pada navigasi lunak — S18-A)', async () => {
  const { execSync } = await import('node:child_process')
  const pages = execSync(`find "app/[locale]/admin/(protected)" -name page.tsx`).toString().trim().split('\n').filter(Boolean)
  assert.ok(pages.length >= 25, 'halaman admin tidak ditemukan — penjaga ini tak bermakna')
  const server = pages.filter((f) => !/^\s*['"]use client['"]/m.test(readFileSync(f, 'utf8').split('\n').slice(0, 3).join('\n')))
  const withData = server.filter((f) => /@\/lib\/db|prisma\./.test(readFileSync(f, 'utf8')))
  assert.ok(withData.length >= 6, `hanya ${withData.length} halaman server+DB — pemindai mungkin rusak`)
  const unguarded = withData.filter((f) => !/requireAdminPage\(|requireSession\(|requireAdmin\(|requireManager\(|requireSuperAdmin\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(unguarded, [], 'halaman admin membaca DB tanpa penjaga sesi sendiri')
})

await t('middleware tidak mengimpor session.ts (memakai Prisma → tak boleh masuk bundel Edge)', async () => {
  const src = readFileSync('middleware.ts', 'utf8')
  assert.doesNotMatch(src, /from '@\/lib\/auth\/session'/)
})

await t('createSession dipanggil hanya dengan id (+ versi yang diverifikasi login); peran tak bisa disodorkan pemanggil', async () => {
  const { execSync } = await import('node:child_process')
  const hits = execSync(`grep -rn "createSession(" app lib --include='*.ts' | grep -v "lib/auth/session.ts" || true`).toString().trim().split('\n').filter(Boolean)
  assert.ok(hits.length >= 5, 'pemanggil createSession tidak ditemukan — penjaga ini tak bermakna')
  for (const h of hits) assert.match(h, /createSession\([A-Za-z.]+(, [A-Za-z.]+\.sessionVersion)?\)/, h) // hanya id (+ versi yang diverifikasi login) — peran tak bisa disodorkan
})

await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
await prisma.$disconnect()
console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
