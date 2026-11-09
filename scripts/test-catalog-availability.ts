// Penjaga "layanan tampil hanya bila ada produknya" (docs/arsitektur-frontend-publik.md §7). Bagian sumber tanpa DB; bagian DB hanya di database sekali pakai.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { prisma } from '@/lib/db'
import { CATALOG_KEYS, availableCatalogs, isCatalogKey, targetAvailable } from '@/lib/catalog/availability'
import { PUBLIC_NAV } from '@/components/shared/publicNav'
import { PUBLIC_PAGES } from '@/lib/public-content/pages'
import { assertThrowawayDb } from './lib/testDb'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}
const read = (p: string) => readFileSync(p, 'utf8')
const page = (k: string) => `app/[locale]/(public)/${k}/page.tsx`

await t('setiap layanan menu, katering, dan setiap katalog Konten Situs punya aturan "ada produk"', () => {
  for (const { key } of PUBLIC_NAV) assert.ok(isCatalogKey(key), `PUBLIC_NAV ${key} tanpa aturan di lib/catalog/availability.ts`)
  assert.ok(isCatalogKey('catering'))
  for (const [k, def] of Object.entries(PUBLIC_PAGES)) if (def.path) assert.ok(isCatalogKey(def.path), `halaman ${k} tanpa aturan`)
})

await t('setiap halaman katalog = 404 bila layanannya tanpa produk (requireCatalog di awal)', () => {
  for (const k of CATALOG_KEYS) {
    assert.ok(existsSync(page(k)), `${k}: halaman katalog tidak ada`)
    const src = read(page(k))
    const body = src.slice(src.indexOf('export default async function'))
    const call = body.indexOf(`await requireCatalog('${k}')`)
    assert.ok(call > 0, `${k}: tidak memanggil requireCatalog('${k}')`)
    assert.ok(call < body.indexOf('Promise.all') || body.indexOf('Promise.all') < 0, `${k}: requireCatalog harus sebelum memuat data`)
  }
})

await t('menu, footer, beranda, sitemap, dan tombol hero/CTA memakai satu sumber', () => {
  for (const f of ['app/[locale]/(public)/_home/HomeSteps.tsx', 'components/shared/Header.tsx', 'components/shared/PublicFooter.tsx', 'app/[locale]/(public)/_home/HomeServices.tsx', 'app/sitemap.ts', 'lib/public-content/content.ts']) {
    assert.match(read(f), /availableCatalogs\(\)/, `${f}: tidak memakai availableCatalogs`)
  }
  assert.match(read('lib/public-content/content.ts'), /targetAvailable\(target, available\)/)
  // Menu HP = komponen klien: daftar dari Header lewat props, tidak mengambil data sendiri.
  const mobile = read('components/shared/PublicMobileNav.tsx')
  assert.match(mobile, /keys: readonly string\[\]/)
  assert.match(mobile, /PUBLIC_NAV\.filter\(n => keys\.includes\(n\.key\)\)/)
  assert.doesNotMatch(mobile, /lib\/db|availability/)
  assert.match(read('components/shared/Header.tsx'), /keys=\{items\.map/)
  // Tidak ada lagi daftar katalog tetap di sitemap atau tautan katering tetap di footer.
  assert.doesNotMatch(read('app/sitemap.ts'), /'hotels', 'transport'/)
  assert.doesNotMatch(read('components/shared/PublicFooter.tsx'), /\/catering`/)
})

await t('targetAvailable: tujuan bukan katalog selalu boleh; katalog hanya bila berproduk', () => {
  const some = new Set(['visa'])
  assert.equal(targetAvailable('', some), true)
  assert.equal(targetAvailable('register', some), true)
  assert.equal(targetAvailable('#catalog', some), true)
  assert.equal(targetAvailable('visa', some), true)
  assert.equal(targetAvailable('haji', some), false)
})

if (process.argv.includes('--no-db')) {
  console.log('(bagian DB dilewati)')
} else {
  await assertThrowawayDb()
  await t('DB: tanpa produk aktif → tidak tampil; satu aktif → tampil; dinonaktifkan → hilang lagi', async () => {
    await prisma.cateringOption.updateMany({ where: { isActive: true }, data: { isActive: false } })
    assert.equal((await availableCatalogs()).has('catering'), false)
    const row = await prisma.cateringOption.create({ data: { name: 'Uji ketersediaan', boardType: 'full_board', menuStyle: 'asian' } })
    try {
      assert.equal((await availableCatalogs()).has('catering'), true)
      await prisma.cateringOption.update({ where: { id: row.id }, data: { isActive: false } })
      assert.equal((await availableCatalogs()).has('catering'), false)
    } finally {
      await prisma.cateringOption.delete({ where: { id: row.id } })
    }
  })
  await t('DB: Pesawat butuh jadwal aktif PADA rute aktif', async () => {
    const before = (await availableCatalogs()).has('flight')
    const active = await prisma.flightSchedule.count({ where: { isActive: true, route: { isActive: true } } })
    assert.equal(before, active > 0)
  })
}

await prisma.$disconnect()
if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua lulus')
