// Penjaga jalur bayar: semua yang ditagih tampil ke jamaah dan admin, bukti transfer diperiksa dari ISI berkas, dan tautan bukti menuju route yang ada.
// Temuan simulasi 2026-11-06: tombol unggah mengarah ke halaman 404, 4 dari 8 produk tak tampil ke jamaah, tautan "Lihat Bukti" mengarah ke route yang tak pernah ada.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { NextResponse } from 'next/server'
import { DocumentFileRejected, prepareDocumentFile } from '@/lib/documents/file'
import { readSingleFile } from '@/lib/documents/http'

const read = (p: string) => readFileSync(p, 'utf8')
let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`ok   ${name}`) } catch (e) { failed++; console.error(`GAGAL ${name}\n     ${e instanceof Error ? e.message : String(e)}`) }
}

const PILGRIM = 'app/[locale]/(pilgrim)/bookings/[id]/page.tsx'
const ADMIN = 'app/[locale]/admin/(protected)/bookings/[id]/page.tsx'
const BUKTI = 'app/api/v1/bookings/[id]/payment/bukti/route.ts'

// Penemu sumber: jenis item ditemukan dari penulis tunggal baris harga, bukan daftar yang dihafal. Jenis baru tanpa kartu = merah.
const itemTypes = [...new Set([...read('lib/booking/lineItems.ts').matchAll(/add\(\{ itemType: '(\w+)'/g)].map(m => m[1]!))]
const RELATION: Record<string, string> = { hotel: 'hotels', transport: 'transports', muthowif: 'muthowif', catering: 'catering', tourPackage: 'tourPackages', haji: 'haji', flight: 'flights', package: 'packages', visa: 'pilgrims' }

await t('penemu menemukan semua jenis item', () => assert.ok(itemTypes.length >= 9, itemTypes.join(',')))
await t('setiap jenis item punya kartu berharga di halaman jamaah', () => {
  const page = read(PILGRIM)
  for (const type of itemTypes) assert.ok(page.includes(`sellOf('${type}'`), `jamaah: ${type} ditagih tapi tak tampil`)
})
await t('setiap jenis item tampil di detail booking admin', () => {
  const page = read(ADMIN)
  for (const type of itemTypes) {
    const relation = RELATION[type]
    assert.ok(relation, `jenis baru ${type}: tambahkan ke RELATION dan kartu admin`)
    assert.ok(page.includes(`booking.${relation}.map(`), `admin: ${type} ditagih tapi tak tampil`)
  }
})
await t('rincian jamaah menjumlah ke tagihan: penyesuaian total tampil terpisah', () => {
  assert.match(read(PILGRIM), /<OrderSummaryCard[^>]*adjustment=/)
  // Sejak I4 teksnya di berkas pesan (pilgrimArea.summary.adjustment), bukan di komponen.
  const card = read('app/[locale]/(pilgrim)/bookings/[id]/OrderSummaryCard.tsx')
  assert.match(card, /useTranslations\('pilgrimArea\.summary'\)/)
  assert.match(card, /adjustment !== 0 &&[\s\S]*?t\('adjustment'\)/)
  for (const locale of ['id', 'en']) {
    const msg = (JSON.parse(read(`i18n/messages/${locale}.json`)) as { pilgrimArea?: { summary?: { adjustment?: unknown } } }).pilgrimArea?.summary?.adjustment
    assert.ok(typeof msg === 'string' && msg.length > 0, `pesan pilgrimArea.summary.adjustment (${locale}) tidak ada`)
  }
})

await t('route bukti tidak mempercayai MIME/nama dari klien dan tidak melewati penyimpanan di dev', () => {
  const route = read(BUKTI)
  assert.match(route, /prepareDocumentFile\(raw\)/)
  assert.match(route, /readSingleFile\(request\)/)
  assert.ok(!/file\.type|file\.name|NODE_ENV/.test(route))
  assert.ok(!/ok\(\{ filePath/.test(route), 'kunci objek tak dikirim ke klien')
})
await t('tautan bukti menuju route yang ada dan dijaga admin', () => {
  assert.ok(!read(PILGRIM).includes('upload-bukti'), 'halaman upload-bukti tidak ada')
  assert.ok(!read('app/[locale]/admin/(protected)/bookings/[id]/PaymentActions.tsx').includes('/api/v1/admin/bukti/'), 'route lama tak pernah ada')
  const view = 'app/api/v1/admin/payments/[id]/bukti/route.ts'
  assert.ok(existsSync(view))
  assert.match(read(view), /await requireAdmin\(\)/)
  assert.ok(!/searchParams|req\.url/.test(read(view)), 'kunci objek hanya dari baris pembayaran, bukan dari permintaan')
})

// Badan multipart ditulis tangan: isi permintaan tepat seperti yang dikirim peramban, dengan Content-Length.
const multipart = (parts: { name: string; filename?: string; value: string }[]) => {
  const body = parts.map(p => `--B\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"\r\nContent-Type: text/plain` : ''}\r\n\r\n${p.value}\r\n`).join('') + '--B--\r\n'
  return new Request('http://x/u', { method: 'POST', body, headers: { 'content-type': 'multipart/form-data; boundary=B', 'content-length': String(Buffer.byteLength(body)) } })
}
const statusOf = (r: Buffer | NextResponse) => r instanceof NextResponse ? r.status : 'berkas'
await t('readSingleFile: kolom tambahan dan berkas ganda ditolak, satu berkas diterima', async () => {
  const good = await readSingleFile(multipart([{ name: 'file', filename: 'a.txt', value: 'halo' }]))
  assert.ok(Buffer.isBuffer(good) && good.toString() === 'halo', String(statusOf(good)))
  assert.equal(statusOf(await readSingleFile(multipart([{ name: 'file', filename: 'a', value: 'x' }, { name: 'amount', value: '1' }]))), 400)
  assert.equal(statusOf(await readSingleFile(multipart([{ name: 'file', filename: 'a', value: 'x' }, { name: 'file', filename: 'b', value: 'y' }]))), 400)
  assert.equal(statusOf(await readSingleFile(multipart([{ name: 'file', value: 'teks' }]))), 400)
})
await t('readSingleFile: tanpa Content-Length 411, terlalu besar 413 sebelum badan dibaca', async () => {
  const noLen = await readSingleFile(new Request('http://x/u', { method: 'POST', body: 'x' }))
  assert.ok(noLen instanceof NextResponse && noLen.status === 411)
  const big = await readSingleFile(new Request('http://x/u', { method: 'POST', body: 'x', headers: { 'content-length': String(6 * 1024 * 1024) } }))
  assert.ok(big instanceof NextResponse && big.status === 413)
})
await t('berkas palsu berlabel gambar ditolak dari isinya', async () => {
  await assert.rejects(prepareDocumentFile(Buffer.from('<html><script>alert(1)</script></html>')), DocumentFileRejected)
  await assert.rejects(prepareDocumentFile(Buffer.alloc(0)), DocumentFileRejected)
})

if (failed > 0) { console.error(`${failed} uji gagal`); process.exit(1) }
console.log('test-payment-path: semua lolos')
