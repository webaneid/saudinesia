// QRIS (docs/arsitektur-booking-engine-v2.md §10.11 Fase 8) terhadap DATABASE SUNGGUHAN (sekali pakai):
// EMV (CRC, bentuk sah, dinamis: Tag 01/54/62-05 + CRC baru), baca QR dari gambar (bolak-balik lewat PNG), QRIS yang boleh dipakai pelanggan
// (metode aktif, QRIS aktif, payload bisa dinamis — K8-2 selalu terkini), akun kas QRIS (hanya uang MASUK), dan penjaga sumber route.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { prisma } from '@/lib/db'
import { buildDynamicQris, crc16, isUsableQrisPayload, isValidQrisPayload, qrisMerchantName, QrisError } from '@/lib/qris/emv'
import { decodeQrisPayload } from '@/lib/qris/decode'
import { payableQris } from '@/lib/qris/payable'
import { qrisSvg } from '@/lib/qris/render'
import { cashTargetOptions, ensureQrisCashAccount, resolveCashTarget } from '@/lib/cash/accounts'
import { assertThrowawayDb } from './lib/testDb'
import { sampleStaticQris } from './lib/qrisSample'

await assertThrowawayDb()
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

/** Urai TLV tingkat atas (uji saja). */
function tlvs(payload: string): Map<string, string> {
  const out = new Map<string, string>()
  for (let i = 0; i + 4 <= payload.length;) {
    const tag = payload.slice(i, i + 2); const len = Number(payload.slice(i + 2, i + 4))
    out.set(tag, payload.slice(i + 4, i + 4 + len)); i += 4 + len
  }
  return out
}

/** Urutan tag tingkat atas (deteksi tag ganda). */
function tags(payload: string): string[] {
  const out: string[] = []
  for (let i = 0; i + 4 <= payload.length;) { out.push(payload.slice(i, i + 2)); i += 4 + Number(payload.slice(i + 2, i + 4)) }
  return out
}

// ── murni ────────────────────────────────────────────────────────────────────────────────────────
const S = sampleStaticQris()

await t('CRC16-CCITT (FFFF): vektor baku "123456789" = 29B1', () => {
  assert.equal(crc16('123456789'), '29B1')
})

await t('payload sah: contoh statis lolos; CRC salah, tanpa 000201, karakter non-ASCII, sisa TLV, > 1000 karakter ditolak; tanpa Tag 53 = sah tapi tak bisa dinamis', () => {
  assert.ok(isValidQrisPayload(S) && isUsableQrisPayload(S))
  assert.equal(qrisMerchantName(S), 'TOKO UJI')
  const flip = S.slice(0, -1) + (S.endsWith('0') ? '1' : '0')
  for (const bad of [flip, S.slice(6), S.replace('TOKO UJI', 'TOKO ÜJI'), '000201' + 'x'.repeat(1001), 'http://evil']) assert.equal(isValidQrisPayload(bad), false, bad.slice(0, 40))
  const no53 = (() => { const b = S.slice(0, -8).replace('5303360', '') + '6304'; return b + crc16(b) })()
  assert.ok(isValidQrisPayload(no53) && !isUsableQrisPayload(no53))
  assert.throws(() => buildDynamicQris(no53, 1000, 'X'), QrisError)
})

await t('dinamis: Tag 01 = 12, Tag 54 = nominal tepat sesudah 53, Tag 62/05 = referensi (≤ 25, ASCII), CRC baru sah; nominal tak bulat/≤ 0/terlalu besar ditolak', () => {
  const d = buildDynamicQris(S, 8_700_858, 'INV-2026-0028')
  assert.ok(isValidQrisPayload(d))
  const m = tlvs(d.slice(0, -8))
  assert.equal(m.get('01'), '12'); assert.equal(m.get('54'), '8700858'); assert.equal(m.get('59'), 'TOKO UJI')
  assert.equal(tlvs(m.get('62')!).get('05'), 'INV-2026-0028')
  assert.ok(d.indexOf('5303360') + 7 === d.indexOf('5407'), '54 tepat sesudah 53')
  const long = tlvs(tlvs(buildDynamicQris(S, 1, 'INV-' + 'x'.repeat(40) + 'é').slice(0, -8)).get('62')!).get('05')!
  assert.equal(long.length, 25); assert.match(long, /^[\x20-\x7E]+$/)
  // Dinamis dari dinamis: nominal lama DIGANTI (bukan ditambah dua Tag 54)
  const twice = buildDynamicQris(d, 5, 'R')
  assert.equal(tlvs(twice.slice(0, -8)).get('54'), '5'); assert.equal(tags(twice.slice(0, -8)).filter(x => x === '54').length, 1)
  for (const bad of [0, -1, 1.5, Number.NaN, 10_000_000_000]) assert.throws(() => buildDynamicQris(S, bad, 'R'), QrisError, String(bad))
  // Tip/biaya layanan merchant (Tag 55/56/57) dibuang: yang dibayar persis Tag 54 (K8-4)
  const withTip = (() => { const b = S.slice(0, -8).replace('5303360', '53033605502035603500') + '6304'; return b + crc16(b) })()
  assert.ok(isUsableQrisPayload(withTip))
  assert.deepEqual(tags(buildDynamicQris(withTip, 10, 'R').slice(0, -8)).filter(x => ['55', '56', '57'].includes(x)), [])
})

await t('baca gambar: PNG/JPEG/WebP berisi QR QRIS → payload persis; QR bukan QRIS, gambar tanpa QR, bukan gambar → null', async () => {
  const png = await QRCode.toBuffer(S, { type: 'png', margin: 4, width: 500 })
  assert.equal(await decodeQrisPayload(png), S)
  assert.equal(await decodeQrisPayload(await sharp(png).jpeg({ quality: 90 }).toBuffer()), S)
  assert.equal(await decodeQrisPayload(await sharp(png).webp().toBuffer()), S)
  assert.equal(await decodeQrisPayload(await QRCode.toBuffer('https://example.test', { type: 'png', width: 400 })), null)
  assert.equal(await decodeQrisPayload(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer()), null)
  assert.equal(await decodeQrisPayload(Buffer.from('%PDF-1.4 bukan gambar')), null)
})

await t('render: SVG murni (tanpa skrip/tautan/handler) dan QR-nya terbaca kembali sebagai payload dinamis yang sama', async () => {
  const d = buildDynamicQris(S, 1_000_123, 'INV-X')
  const svg = await qrisSvg(d)
  assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/)
  assert.doesNotMatch(svg, /<script|href=|on[a-z]+=/i)
  assert.equal(await decodeQrisPayload(await sharp(Buffer.from(svg)).png().toBuffer()), d)
})

// ── basis data ───────────────────────────────────────────────────────────────────────────────────
const tag = `qr${Date.now()}`
const settings = await prisma.invoiceSettings.findUniqueOrThrow({ where: { id: 'global' }, select: { methodQris: true } })
const good = await prisma.qrisAccount.create({ data: { name: `${tag} Utama`, emvPayload: sampleStaticQris('UTAMA'), sortOrder: -2 } })
const off = await prisma.qrisAccount.create({ data: { name: `${tag} Mati`, emvPayload: sampleStaticQris('MATI'), isActive: false, sortOrder: -1 } })
const empty = await prisma.qrisAccount.create({ data: { name: `${tag} Kosong`, emvPayload: null } })
const mine = (l: Array<{ id: string }>) => l.filter(q => [good.id, off.id, empty.id].includes(q.id)).map(q => q.id)

await t('payableQris (K8-2 selalu terkini): metode QRIS mati → kosong; hidup → hanya QRIS aktif berpayload sah; payload ikut berubah saat QRIS diedit', async () => {
  try {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { methodQris: false } })
    assert.deepEqual(await payableQris(), [])
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: { methodQris: true } })
    assert.deepEqual(mine(await payableQris()), [good.id])
    await prisma.qrisAccount.update({ where: { id: good.id }, data: { emvPayload: sampleStaticQris('BARU') } })
    assert.equal(qrisMerchantName((await payableQris()).find(q => q.id === good.id)!.payload), 'BARU')
  } finally {
    await prisma.invoiceSettings.update({ where: { id: 'global' }, data: settings })
  }
})

await t('akun kas QRIS: dibuat sekali (serentak tak menggandakan); QRIS nonaktif ditolak untuk pilihan baru; hanya untuk uang MASUK (refund/vendor → null)', async () => {
  const ids = await Promise.all([1, 2, 3].map(() => prisma.$transaction(tx => ensureQrisCashAccount(tx, good.id, { requireActive: true }))))
  assert.ok(ids[0] && ids.every(i => i === ids[0]))
  const row = await prisma.cashAccount.findUniqueOrThrow({ where: { id: ids[0]! }, select: { kind: true, qrisAccountId: true, bankAccountId: true, systemKey: true } })
  assert.deepEqual(row, { kind: 'qris', qrisAccountId: good.id, bankAccountId: null, systemKey: null })
  assert.equal(await prisma.$transaction(tx => ensureQrisCashAccount(tx, off.id, { requireActive: true })), null)
  assert.equal(await prisma.$transaction(tx => resolveCashTarget(tx, { kind: 'qris', qrisAccountId: good.id })), null, 'keluar dari QRIS ditolak')
  assert.equal(await prisma.$transaction(tx => resolveCashTarget(tx, { kind: 'qris', qrisAccountId: good.id }, { incoming: true })), ids[0])
  const outOpts = (await cashTargetOptions()).map(o => o.value)
  const inOpts = (await cashTargetOptions({ incoming: true })).map(o => o.value)
  assert.ok(!outOpts.some(v => v.startsWith('qris:')) && inOpts.includes(`qris:${good.id}`) && !inOpts.includes(`qris:${off.id}`))
})

await t('DB: bentuk akun kas QRIS dijaga CHECK (qris tanpa qrisAccountId / qris + bankAccountId ditolak); QRIS berakun kas tak bisa dihapus (FK Restrict)', async () => {
  const rejects = async (sql: string, why: string) => { await assert.rejects(prisma.$executeRawUnsafe(sql), Error, why) }
  await rejects(`INSERT INTO cash_accounts (id, kind, name) VALUES ('${tag}-a', 'qris', 'x')`, 'qris tanpa qrisAccountId')
  const bank = await prisma.bankAccount.create({ data: { bankName: `${tag} BSI`, accountNumber: '9', accountHolder: 'PT' } })
  await rejects(`INSERT INTO cash_accounts (id, kind, name, "qrisAccountId", "bankAccountId") VALUES ('${tag}-b', 'qris', 'x', '${empty.id}', '${bank.id}')`, 'qris + bank')
  await assert.rejects(prisma.qrisAccount.delete({ where: { id: good.id } }), Error, 'QRIS berakun kas')
})

// ── penjaga sumber ───────────────────────────────────────────────────────────────────────────────
await t('route QR pelanggan: sesi PEMILIK (userId), draf 404, QRIS dari payableQris, nominal dinilai paymentLimits, total = nominal + kode unik invoice, no-store/nosniff/CSP', () => {
  const s = read('app/api/v1/bookings/[id]/payment/qris/route.ts')
  assert.match(s, /requireSession\(\)[\s\S]*userId: session\.userId, status: \{ not: 'draft' \}/)
  assert.match(s, /payableQris\(\)\)\.find/)
  assert.match(s, /claimRefusal\(paymentLimits\(billOf\(booking\)/)
  assert.match(s, /parsed\.data\.amount \+ \(booking\.invoice\.uniqueCode \?\? 0\)/)
  assert.match(s, /'Cache-Control': 'private, no-store'[\s\S]*nosniff[\s\S]*default-src 'none'/)
})

await t('unggah bukti ke QRIS: tujuan dari payableQris (bukan id bebas), akun kas lewat ensureQrisCashAccount(requireActive) di dalam kunci, method qris', () => {
  const s = read('app/api/v1/bookings/[id]/payment/bukti/route.ts')
  assert.match(s, /qrisList\.find\(q => q\.id ===/)
  assert.match(s, /FOR UPDATE[\s\S]*ensureQrisCashAccount\(tx, destQris!\.id, \{ requireActive: true \}\)/)
  assert.match(s, /method: +destQris \? 'qris' : 'bank_transfer'/)
})

await t('uang KELUAR tak pernah lewat QRIS: refund & biaya vendor memanggil resolveCashTarget TANPA incoming; hanya verifikasi pembayaran yang incoming', () => {
  assert.match(read('lib/payments/process.ts'), /resolveCashTarget\(tx, input\.cashAccount, \{ incoming: true \}\)/)
  for (const f of ['lib/refunds/service.ts', 'lib/costs/actuals.ts']) assert.doesNotMatch(read(f), /incoming/, f)
})

await t('payload QRIS statis tak pernah sampai ke klien: halaman jamaah hanya id+nama; invoice publik hanya gambar data URI dari QR dinamis', () => {
  assert.match(read('app/[locale]/(pilgrim)/bookings/[id]/page.tsx'), /payableQris\(\)\)\.map\(q => \(\{ id: q\.id, name: q\.name \}\)\)/)
  const inv = read('app/[locale]/invoice/[token]/page.tsx')
  assert.match(inv, /d\.payable && qrisTotal > 0/)
  assert.match(inv, /qrisSvg\(buildDynamicQris\(q\.payload, qrisTotal, d\.invoiceNumber\)\)/)
  // Sisa bersen dibulatkan ke atas; QR yang gagal dibuat dilewati (halaman tak 500)
  assert.match(inv, /Math\.ceil\(d\.balanceDue\)/)
  assert.match(inv, /try \{[\s\S]*buildDynamicQris[\s\S]*\} catch/)
})

await t('baca gambar QRIS (admin): superadmin saja, Content-Length sebelum formData, satu berkas ≤ 5 MB, terdaftar di @unggah Caddy', () => {
  const s = read('app/api/v1/admin/system/qris-accounts/decode/route.ts')
  assert.match(s, /requireSuperAdmin\(\)/)
  assert.ok(s.indexOf('content-length') < s.indexOf('formData()'), 'Content-Length dulu')
  assert.match(read('Caddyfile'), /admin\/system\/qris-accounts\/decode/)
})

// bersih-bersih
await prisma.cashAccount.deleteMany({ where: { qrisAccountId: { in: [good.id, off.id, empty.id] } } })
await prisma.qrisAccount.deleteMany({ where: { id: { in: [good.id, off.id, empty.id] } } })
await prisma.bankAccount.deleteMany({ where: { bankName: { startsWith: tag } } })

console.log(failed ? `\n${failed} uji GAGAL` : '\nSemua uji QRIS lolos')
await prisma.$disconnect()
process.exit(failed ? 1 : 0)
