// Uji media produk universal (docs/arsitektur-media.md, F1): pemrosesan gambar (isi berkas, bukan MIME klien), layanan terhadap DB SUNGGUHAN dengan
// penyimpanan memori (invarian featured/gallery, batas, sampul, urutan, hapus + pembersihan objek), penyedia URL batch, dan handler API (otorisasi/
// validasi/penolakan). Migrasi: scripts/test-media-migration.ts.
//
// PENGAMAN: menulis data sementara → menolak jalan kecuali nama database memuat "test", "_ci" atau "tmp".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ProductImage } from '@/components/shared/ProductImage'
import { prisma } from '@/lib/db'
import { processImage, ImageRejectedError, MAX_UPLOAD_BYTES } from '@/lib/media/image'
import { createMediaService } from '@/lib/media/service'
import { getProductImages } from '@/lib/media/urls'
import { createMediaHandlers } from '@/lib/media/handlers'
import { MEDIA_OWNERS } from '@/lib/media/owners'
import type { MediaStorage } from '@/lib/media/storage'
import { assertThrowawayDb } from './lib/testDb'

await assertThrowawayDb()

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

// ── penyimpanan memori ──
function memoryStorage(opts: { failPut?: () => boolean } = {}) {
  const objects = new Map<string, Buffer>()
  const storage: MediaStorage = {
    put: async (key, body) => { if (opts.failPut?.()) throw new Error('storage down'); objects.set(key, body) },
    remove: async (key) => { objects.delete(key) },
    url: async (key) => { if (!objects.has(key)) throw new Error('missing'); return `mem://${key}` },
    newKey: (entity, id, name) => `${entity}/${id}/images/${name}`,
  }
  return { storage, objects }
}

const png = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer()
const jpeg = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 120, b: 200 } } }).jpeg().toBuffer()

// ── pemrosesan gambar ──
await t('processImage: PNG/JPEG/WebP sah diproses ke webp; tampilan ≤1600 px, kartu ≤640 px; tanpa pembesaran', async () => {
  for (const make of [png, jpeg, async () => sharp({ create: { width: 500, height: 500, channels: 3, background: '#fff' } }).webp().toBuffer()]) {
    const r = await processImage(await make(3200, 2000))
    assert.ok(r.width <= 1600 && r.height <= 1600); assert.ok((await sharp(r.card).metadata()).width! <= 640)
    assert.equal((await sharp(r.display).metadata()).format, 'webp')
  }
  const small = await processImage(await png(300, 200))
  assert.equal(small.width, 300, 'gambar kecil tidak diperbesar')
})

await t('processImage: berkas BUKAN gambar ditolak walau berekstensi/ber-MIME gambar (teks, GIF, PDF, ZIP, PNG terpotong, kosong, terlalu besar)', async () => {
  const gif = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1')
  const cases: Array<[string, Buffer]> = [
    ['teks', Buffer.from('<script>alert(1)</script> ini bukan gambar')], ['gif', gif], ['pdf', Buffer.from('%PDF-1.4 fake')],
    ['zip', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], ['png terpotong (hanya tanda tangan)', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])],
    ['kosong', Buffer.alloc(0)],
  ]
  for (const [name, buf] of cases) await assert.rejects(processImage(buf), ImageRejectedError, name)
  await assert.rejects(processImage(Buffer.concat([await png(), Buffer.alloc(MAX_UPLOAD_BYTES)])), /5 MB/)
})

await t('processImage: EXIF (termasuk GPS) dibuang dan orientasi diterapkan', async () => {
  const withExif = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#0a0' } }).jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'rahasia' } } }).toBuffer()
  const meta = await sharp(withExif).metadata()
  assert.ok(meta.exif && meta.orientation === 6, 'fixture harus memuat EXIF dengan orientasi 6')
  const r = await processImage(withExif)
  assert.equal((await sharp(r.display).metadata()).exif, undefined, 'EXIF harus hilang')
  assert.deepEqual([r.width, r.height], [50, 100], 'orientasi 6 memutar 100x50 → 50x100')
})

// ── layanan (DB sungguhan) ──
const tag = `media${Date.now()}`
const mkHotel = () => prisma.hotel.create({ data: { name: `${tag} hotel`, city: 'makkah' } })
const mkHaji = () => prisma.hajiProduct.create({ data: { name: `${tag} haji`, hajiType: 'khusus', year: 2027, price: 0, totalQuota: 1 } })

await t('galeri (hotel): foto pertama = sampul; berikutnya bukan; urutan bertambah; objek tampilan + kartu tersimpan', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const hotel = await mkHotel()
  const a = await svc.add('hotel', hotel.id, await png(), '  Lobi  ')
  const b = await svc.add('hotel', hotel.id, await jpeg())
  assert.ok(a.ok && b.ok)
  if (a.ok && b.ok) {
    assert.equal(a.image.isFeatured, true); assert.equal(b.image.isFeatured, false); assert.equal(b.image.sortOrder, a.image.sortOrder + 1)
    assert.equal(a.image.alt, 'Lobi', 'alt dipangkas')
    assert.ok(objects.has(a.image.key) && objects.has(a.image.cardKey!))
    assert.ok(a.image.key.startsWith(`hotel/${hotel.id}/images/`) && a.image.key.endsWith('-display.webp'))
  }
  assert.equal(objects.size, 4)
})

await t('batas galeri: tambahan melewati max → 409 dan objek yang sudah diunggah dibersihkan (tak ada yatim)', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const hotel = await mkHotel(); const img = await png(100, 100)
  for (let i = 0; i < MEDIA_OWNERS.hotel.max; i++) assert.ok((await svc.add('hotel', hotel.id, img)).ok)
  const before = objects.size
  const over = await svc.add('hotel', hotel.id, img)
  assert.equal(over.ok, false); assert.equal(over.ok === false && over.status, 409); assert.equal(objects.size, before, 'objek unggahan ditolak harus dibersihkan')
  assert.equal(await prisma.productImage.count({ where: { productType: 'hotel', productId: hotel.id } }), MEDIA_OWNERS.hotel.max)
})

await t('unggulan (haji): unggah baru MENGGANTI — tepat satu baris, objek lama dihapus, selalu sampul', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const haji = await mkHaji()
  const first = await svc.add('haji', haji.id, await png()); assert.ok(first.ok)
  const second = await svc.add('haji', haji.id, await jpeg()); assert.ok(second.ok)
  const rows = await svc.list('haji', haji.id)
  assert.equal(rows.length, 1); assert.equal(rows[0]!.isFeatured, true)
  if (first.ok && second.ok) { assert.equal(rows[0]!.id, second.image.id); assert.ok(!objects.has(first.image.key) && !objects.has(first.image.cardKey!), 'objek lama harus terhapus') }
  assert.equal(objects.size, 2)
})

await t('sampul: pindah ke foto lain (tepat satu sampul); melepas sampul ditolak; alt diubah', async () => {
  const { storage } = memoryStorage(); const svc = createMediaService(storage)
  const hotel = await mkHotel()
  const a = await svc.add('hotel', hotel.id, await png(50, 50)); const b = await svc.add('hotel', hotel.id, await png(60, 60))
  assert.ok(a.ok && b.ok); if (!(a.ok && b.ok)) return
  const moved = await svc.update('hotel', hotel.id, b.image.id, { isFeatured: true }); assert.ok(moved.ok)
  const rows = await svc.list('hotel', hotel.id)
  assert.deepEqual(rows.map(r => [r.id, r.isFeatured]), [[b.image.id, true], [a.image.id, false]], 'sampul pertama dalam daftar; hanya satu')
  const unfeature = await svc.update('hotel', hotel.id, b.image.id, { isFeatured: false }); assert.equal(unfeature.ok, false)
  const alt = await svc.update('hotel', hotel.id, a.image.id, { alt: '  ' }); assert.ok(alt.ok && alt.image.alt === null, 'alt kosong → null')
})

await t('urutan: harus memuat tepat semua id; salah satu kurang/asing → 400; urutan baru tersimpan', async () => {
  const { storage } = memoryStorage(); const svc = createMediaService(storage)
  const hotel = await mkHotel(); const ids: string[] = []
  for (let i = 0; i < 3; i++) { const r = await svc.add('hotel', hotel.id, await png(40 + i, 40)); if (r.ok) ids.push(r.image.id) }
  assert.equal((await svc.reorder('hotel', hotel.id, [ids[0]!, ids[1]!])).ok, false)
  assert.equal((await svc.reorder('hotel', hotel.id, [ids[0]!, ids[1]!, '00000000-0000-4000-8000-000000000000'])).ok, false)
  assert.ok((await svc.reorder('hotel', hotel.id, [ids[2]!, ids[0]!, ids[1]!])).ok)
  const rows = await svc.list('hotel', hotel.id)
  assert.deepEqual(rows.map(r => r.id), [ids[0], ids[2], ids[1]], 'sampul (id0) dulu, lalu sortOrder: id2 (0), id1 (2)')
})

await t('hapus: sampul terhapus → foto berikutnya dipromosikan; objek dihapus; foto milik PRODUK LAIN tidak bisa dihapus (SEC-62)', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const h1 = await mkHotel(), h2 = await mkHotel()
  const a = await svc.add('hotel', h1.id, await png(50, 50)); const b = await svc.add('hotel', h1.id, await png(60, 60)); const other = await svc.add('hotel', h2.id, await png(70, 70))
  assert.ok(a.ok && b.ok && other.ok); if (!(a.ok && b.ok && other.ok)) return
  assert.equal((await svc.remove('hotel', h1.id, other.image.id)).ok, false, 'id foto produk lain harus 404')
  assert.ok(objects.has(other.image.key))
  assert.ok((await svc.remove('hotel', h1.id, a.image.id)).ok)
  assert.ok(!objects.has(a.image.key) && !objects.has(a.image.cardKey!))
  const rows = await svc.list('hotel', h1.id); assert.equal(rows.length, 1); assert.equal(rows[0]!.id, b.image.id); assert.equal(rows[0]!.isFeatured, true)
})

await t('removeAll membersihkan baris DAN objek (dipakai saat produk dihapus); produk tak ada / berkas bukan gambar / penyimpanan gagal → ditolak tanpa sisa', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const hotel = await mkHotel()
  await svc.add('hotel', hotel.id, await png(50, 50)); await svc.add('hotel', hotel.id, await png(60, 60))
  assert.equal(await svc.removeAll('hotel', hotel.id), 2); assert.equal(objects.size, 0)
  const ghost = await svc.add('hotel', '00000000-0000-4000-8000-000000000000', await png()); assert.equal(ghost.ok === false && ghost.status, 404)
  const notImage = await svc.add('hotel', hotel.id, Buffer.from('bukan gambar')); assert.equal(notImage.ok === false && notImage.status, 400)
  let calls = 0; const flaky = memoryStorage({ failPut: () => ++calls === 2 }); const svc2 = createMediaService(flaky.storage)
  const down = await svc2.add('hotel', hotel.id, await png()); assert.equal(down.ok === false && down.status, 409)
  assert.equal(flaky.objects.size, 0, 'objek tampilan yang sudah terunggah harus dibersihkan saat kartu gagal'); assert.equal(await prisma.productImage.count({ where: { productId: hotel.id } }), 0)
})

// ── penyedia URL ──
await t('getProductImages: batch banyak produk; sampul dulu; produk tanpa foto → kosong; objek hilang dilewati (halaman tak rusak)', async () => {
  const { storage, objects } = memoryStorage(); const svc = createMediaService(storage)
  const withPhotos = await mkHotel(), without = await mkHotel()
  const a = await svc.add('hotel', withPhotos.id, await png(50, 50)); const b = await svc.add('hotel', withPhotos.id, await png(60, 60))
  assert.ok(a.ok && b.ok); if (!(a.ok && b.ok)) return
  await svc.update('hotel', withPhotos.id, b.image.id, { isFeatured: true })
  const map = await getProductImages('hotel', [withPhotos.id, without.id], storage)
  assert.equal(map.get(without.id)!.featured, null); assert.deepEqual(map.get(without.id)!.images, [])
  const got = map.get(withPhotos.id)!
  assert.equal(got.images[0]!.id, b.image.id); assert.equal(got.featured!.id, b.image.id); assert.ok(got.featured!.cardUrl.endsWith('-card.webp'))
  objects.delete(a.image.key); objects.delete(a.image.cardKey!) // objek hilang di storage
  const again = await getProductImages('hotel', [withPhotos.id], storage)
  assert.deepEqual(again.get(withPhotos.id)!.images.map(i => i.id), [b.image.id])
})

// ── handler API ──
await t('handler API: tipe tak terdaftar / id bukan uuid → 404; tanpa otorisasi → 403; unggah bukan gambar → 400; PATCH liar → 400; GET memuat mode+max', async () => {
  const { storage } = memoryStorage()
  const su = createMediaHandlers({ requireWrite: async () => undefined, storage })
  const anon = createMediaHandlers({ requireWrite: async () => { throw new Error('Unauthorized') }, storage })
  const hotel = await mkHotel()
  const ctx = (productType: string, productId: string) => ({ params: Promise.resolve({ productType, productId }) })
  const ictx = (productType: string, productId: string, imageId: string) => ({ params: Promise.resolve({ productType, productId, imageId }) })
  const get = new Request('http://t/x')
  assert.equal((await su.listGET(get, ctx('hacker', hotel.id))).status, 404)
  assert.equal((await su.listGET(get, ctx('hotel', 'bukan-uuid'))).status, 404)
  assert.equal((await anon.listGET(get, ctx('hotel', hotel.id))).status, 403)
  const form = (file: Blob, name: string) => { const f = new FormData(); f.append('file', file, name); return new Request('http://t/x', { method: 'POST', body: f }) }
  assert.equal((await su.listPOST(form(new Blob(['<?php evil ?>'], { type: 'image/png' }), 'x.png'), ctx('hotel', hotel.id))).status, 400, 'MIME klien tak dipercaya')
  assert.equal((await su.listPOST(new Request('http://t/x', { method: 'POST', body: new FormData() }), ctx('hotel', hotel.id))).status, 400)
  const okRes = await su.listPOST(form(new Blob([new Uint8Array(await png(100, 100))], { type: 'image/png' }), 'a.png'), ctx('hotel', hotel.id)); assert.equal(okRes.status, 201)
  const created = (await okRes.json()).data
  const list = await (await su.listGET(get, ctx('hotel', hotel.id))).json()
  assert.equal(list.data.length, 1); assert.deepEqual(list.meta, { mode: 'gallery', max: MEDIA_OWNERS.hotel.max })
  const patch = (body: unknown) => new Request('http://t/x', { method: 'PATCH', body: JSON.stringify(body) })
  assert.equal((await su.itemPATCH(patch({ isFeatured: true, id: 'x' }), ictx('hotel', hotel.id, created.id))).status, 400, 'kolom liar (.strict)')
  assert.equal((await su.itemPATCH(patch({}), ictx('hotel', hotel.id, created.id))).status, 400)
  assert.equal((await su.itemPATCH(patch({ alt: 'x' }), ictx('hotel', hotel.id, '00000000-0000-4000-8000-000000000000'))).status, 404)
  assert.equal((await su.orderPATCH(patch({ order: [created.id, created.id] }), ctx('hotel', hotel.id))).status, 400)
  assert.equal((await anon.itemDELETE(get, ictx('hotel', hotel.id, created.id))).status, 403)
  assert.equal((await su.itemDELETE(get, ictx('hotel', hotel.id, created.id))).status, 200)
})

await t('registry: setiap pemilik punya mode/max/label dan exists() yang bekerja; featured → max 1; Kendaraan tetap galeri (keputusan pemilik 2026-10-27)', async () => {
  for (const [type, owner] of Object.entries(MEDIA_OWNERS)) {
    assert.ok(owner.label && owner.max >= 1, type); if (owner.mode === 'featured') assert.equal(owner.max, 1, type)
    assert.equal(await owner.exists('00000000-0000-4000-8000-000000000000'), false, `${type}.exists(tak ada)`)
  }
  assert.equal(MEDIA_OWNERS.vehicle.mode, 'gallery'); assert.equal(MEDIA_OWNERS.hotel.mode, 'gallery'); assert.equal(MEDIA_OWNERS.tour_package.mode, 'gallery')
  for (const featured of ['haji', 'package', 'catering', 'visa', 'muthowif', 'tourism_site'] as const) assert.equal(MEDIA_OWNERS[featured].mode, 'featured')
})

// ── penjaga sumber ──
await t('penjaga sumber: HANYA lib/media/service.ts menulis product_images; route generik tipis; jembatan dan komponen foto lama sudah hilang', () => {
  const walk = (dir: string): string[] => (require('node:fs').readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [])
  const writers = [...walk('app'), ...walk('lib'), ...walk('components')].filter(f => f !== 'lib/media/service.ts' && /prisma\.productImage\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(writers, [], 'penulis product_images selain layanan')
  for (const f of ['app/api/v1/admin/media/[productType]/[productId]/route.ts', 'app/api/v1/admin/media/[productType]/[productId]/[imageId]/route.ts']) assert.match(readFileSync(f, 'utf8'), /createMediaHandlers\(\)/)
  for (const gone of ['lib/media/legacyRoutes.ts', 'components/admin/media/ProductMediaGallery.tsx', 'app/api/v1/admin/products/hotels/[id]/images/route.ts', 'app/api/v1/admin/products/muthowif/[id]/photo/route.ts']) assert.ok(!require('node:fs').existsSync(gone), `${gone}: jembatan/komponen lama harus sudah dihapus (F2)`)
  const handlers = readFileSync('lib/media/handlers.ts', 'utf8')
  assert.equal((handlers.match(/await requireWrite\(\)/g) ?? []).length, 5, 'setiap verb memanggil requireWrite lebih dulu')
})

await t('F2: SETIAP tipe di registry punya <MediaField productType="…"> di halaman edit-nya; tak ada unggah foto ad-hoc (input file / route foto lama) di halaman admin', () => {
  const dir = 'app/[locale]/admin/(protected)/products/'
  const pages: Record<keyof typeof MEDIA_OWNERS, string> = {
    hotel: 'hotels/[id]/page.tsx', tour_package: 'tour-packages/[id]/page.tsx', vehicle: 'transport/vehicles/[id]/page.tsx', haji: 'haji/[id]/page.tsx',
    package: 'packages/[id]/page.tsx', catering: 'catering/[id]/page.tsx', visa: 'visa/[id]/ProductInfoTab.tsx', muthowif: 'muthowif/[id]/page.tsx', tourism_site: 'tourism-sites/[id]/page.tsx',
  }
  assert.deepEqual(Object.keys(pages).sort(), Object.keys(MEDIA_OWNERS).sort(), 'tipe baru di registry wajib dipetakan ke halaman edit')
  for (const [type, file] of Object.entries(pages)) assert.match(readFileSync(dir + file, 'utf8'), new RegExp(`<MediaField\\s[^>]*productType="${type}"`), `${type}: MediaField tidak terpasang di ${file}`)
  const walk = (d: string): string[] => (require('node:fs').readdirSync(d, { withFileTypes: true }) as Array<{ name: string; isDirectory: () => boolean }>).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : e.name.endsWith('.tsx') ? [`${d}/${e.name}`] : [])
  const adhoc = walk('app/[locale]/admin').filter(f => /type="file"|\/photo`|\/images`/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(adhoc, [], 'unggah foto ad-hoc di halaman admin (pakai MediaField)')
  const field = readFileSync('components/admin/media/MediaField.tsx', 'utf8')
  assert.equal((field.match(/<button\b(?![^>]*type=)/g) ?? []).length, 0, 'semua <button> di MediaField harus bertipe (aman di dalam form)')
})

await t('F3: ProductImage — ada foto → <img> (alt admin diutamakan, jika kosong nama produk); tanpa foto → placeholder berikon (aria-hidden, tanpa <img>); setiap tipe punya ikon', () => {
  const withPhoto = renderToStaticMarkup(createElement(ProductImage, { src: 'https://x/y.webp', alt: 'Lobi', fallbackAlt: 'Hotel A', type: 'hotel' }))
  assert.match(withPhoto, /<img[^>]+src="https:\/\/x\/y\.webp"/); assert.match(withPhoto, /alt="Lobi"/); assert.match(withPhoto, /loading="lazy"/)
  assert.match(renderToStaticMarkup(createElement(ProductImage, { src: 'https://x/y.webp', alt: null, fallbackAlt: 'Hotel A', type: 'hotel' })), /alt="Hotel A"/)
  for (const type of Object.keys(MEDIA_OWNERS) as Array<keyof typeof MEDIA_OWNERS>) {
    const empty = renderToStaticMarkup(createElement(ProductImage, { src: null, fallbackAlt: 'x', type }))
    assert.ok(!empty.includes('<img'), `${type}: placeholder tak boleh memuat <img>`); assert.match(empty, /aria-hidden="true"/); assert.match(empty, /<svg/)
  }
  assert.match(renderToStaticMarkup(createElement(ProductImage, { src: null, fallbackAlt: 'x', type: 'haji', ratio: 'square' })), /aspect-square/)
})

await t('F3: setiap katalog publik produk bergambar memakai getFeaturedCards + <ProductImage> bertipe benar; API katalog menyertakan coverUrl; tak ada kolom foto lama yang dibaca', () => {
  const pub = 'app/[locale]/(public)/'
  for (const [file, type] of [['haji/page.tsx', 'haji'], ['packages/page.tsx', 'package'], ['catering/page.tsx', 'catering'], ['visa/page.tsx', 'visa'], ['tours/page.tsx', 'tour_package']] as const) {
    const src = readFileSync(pub + file, 'utf8')
    assert.match(src, new RegExp(`getFeaturedCards\\('${type}'`), `${file}: tidak memuat sampul ${type}`)
    assert.match(src, new RegExp(`<ProductImage\\s[^>]*type="${type}"`), `${file}: tak ada ProductImage ${type}`)
  }
  for (const [file, type] of [['haji', 'haji'], ['packages', 'package'], ['catering', 'catering'], ['visa', 'visa'], ['tour-packages', 'tour_package']] as const) {
    const src = readFileSync(`app/api/v1/catalog/${file}/route.ts`, 'utf8')
    assert.match(src, new RegExp(`getFeaturedCards\\('${type}'`), `API ${file}: tanpa sampul`); assert.match(src, /coverUrl/, `API ${file}: tanpa coverUrl`)
  }
  assert.doesNotMatch(readFileSync('lib/haji/catalog.ts', 'utf8'), /images:/, 'katalog Haji tak boleh lagi memetakan kolom foto lama')
})

// ── pembersihan ──
await prisma.productImage.deleteMany({ where: { OR: [{ productType: 'hotel', productId: { in: (await prisma.hotel.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map(h => h.id) } }, { productType: 'haji', productId: { in: (await prisma.hajiProduct.findMany({ where: { name: { startsWith: tag } }, select: { id: true } })).map(h => h.id) } }] } })
await prisma.hotel.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.hajiProduct.deleteMany({ where: { name: { startsWith: tag } } })
await prisma.$disconnect()
if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nsemua lulus')
