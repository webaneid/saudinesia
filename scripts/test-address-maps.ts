import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mapsSearchUrl, parseMapsUrl } from '@/lib/address/maps'
import { addressSchema, addressWithMapSchema } from '@/lib/validators/address'
import { prepareAddressData } from '@/lib/address/prepare'

// Lokasi Google Maps pada alamat hotel (docs/arsitektur-hotel.md §12.5): host whitelist, koordinat dari server, hanya skema hotel yang menerimanya.
let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const root = new URL('..', import.meta.url).pathname
const read = (f: string) => readFileSync(join(root, f), 'utf8')
const okUrl = (raw: string) => { const r = parseMapsUrl(raw); assert.ok(r.ok, `harus diterima: ${raw}`); return r.value }

await t('DITERIMA: tautan Bagikan, google.com/maps (+ domain .co.id / .com.sa), maps.google.com', () => {
  okUrl('https://maps.app.goo.gl/AbCdEf123')
  okUrl('https://www.google.com/maps/place/Hotel/@21.4225,39.8262,17z')
  okUrl('https://google.co.id/maps?q=Movenpick+Makkah')
  okUrl('https://www.google.com.sa/maps/search/?api=1&query=hotel')
  okUrl('https://maps.google.com/?q=21.42,39.82')
  okUrl('  https://maps.app.goo.gl/x  ') // spasi dipangkas
})

await t('DITOLAK: bukan https, skema berbahaya, host tiruan, bukan /maps, kredensial/port, terlalu panjang, kosong', () => {
  for (const raw of [
    'http://maps.app.goo.gl/x', 'javascript:alert(1)', 'data:text/html,<script>', '//maps.app.goo.gl/x',
    'https://evil.com/maps', 'https://google.com.evil.com/maps', 'https://maps.google.com.evil.com/', 'https://evilgoogle.com/maps',
    'https://www.google.com/search?q=hotel', 'https://www.google.com/mapsevil', 'https://goo.gl/abc', 'https://maps.app.goo.gl.evil.io/x',
    'https://user:pw@maps.app.goo.gl/x', 'https://maps.app.goo.gl:8443/x', `https://maps.app.goo.gl/${'a'.repeat(2000)}`, '', '   ', 'bukan tautan',
  ]) assert.equal(parseMapsUrl(raw).ok, false, `harus ditolak: ${raw.slice(0, 60)}`)
})

await t('KOORDINAT: pin tempat (!3d!4d) didahulukan dari pusat peta (@); ?q=lat,lng; tautan pendek / di luar rentang → kosong', () => {
  const pin = okUrl('https://www.google.com/maps/place/X/@21.40,39.80,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d21.4225123!4d39.8261987')
  assert.deepEqual([pin.latitude, pin.longitude], [21.422512, 39.826199])
  const at = okUrl('https://www.google.com/maps/@24.4672,39.6112,15z')
  assert.deepEqual([at.latitude, at.longitude], [24.4672, 39.6112])
  const q = okUrl('https://maps.google.com/?q=-6.2,106.816666')
  assert.deepEqual([q.latitude, q.longitude], [-6.2, 106.816666])
  assert.deepEqual([okUrl('https://maps.app.goo.gl/x').latitude, okUrl('https://www.google.com/maps/@95.1,39.6,15z').latitude], [null, null])
  assert.equal(mapsSearchUrl(' Hotel A&B Makkah '), 'https://www.google.com/maps/search/?api=1&query=Hotel%20A%26B%20Makkah')
})

const intl = { type: 'international' as const, fullAddress: 'Ibrahim Al Khalil St', countryCode: 'SA', city: 'Makkah' }
await t('SKEMA: hanya addressWithMapSchema menerima mapsUrl ("" → null, tautan asing → 400); addressSchema (profil/vendor/invoice) membuangnya', () => {
  assert.equal(addressWithMapSchema.parse({ ...intl, mapsUrl: '' }).mapsUrl, null)
  assert.equal(addressWithMapSchema.safeParse({ ...intl, mapsUrl: 'https://evil.com/maps' }).success, false)
  assert.equal(addressWithMapSchema.parse({ ...intl, mapsUrl: 'https://maps.app.goo.gl/x' }).mapsUrl, 'https://maps.app.goo.gl/x')
  assert.equal(addressWithMapSchema.safeParse({ ...intl, countryCode: null, mapsUrl: 'https://maps.app.goo.gl/x' }).success, false, 'aturan alamat tetap berlaku')
  assert.equal('mapsUrl' in addressSchema.parse({ ...intl, mapsUrl: 'https://maps.app.goo.gl/x' }), false)
})

await t('PENULIS: koordinat selalu diturunkan server dari tautan; tanpa kolom peta → lokasi lama tak disentuh; null → dikosongkan', async () => {
  const withMap = await prepareAddressData({ ...intl, mapsUrl: 'https://www.google.com/maps/@21.4225,39.8262,17z' })
  assert.ok(withMap.ok)
  assert.deepEqual([withMap.data.mapsUrl, withMap.data.latitude, withMap.data.longitude], ['https://www.google.com/maps/@21.4225,39.8262,17z', 21.4225, 39.8262])
  const without = await prepareAddressData(intl)
  assert.ok(without.ok)
  assert.equal('mapsUrl' in without.data || 'latitude' in without.data, false)
  const cleared = await prepareAddressData({ ...intl, mapsUrl: null })
  assert.ok(cleared.ok)
  assert.deepEqual([cleared.data.mapsUrl, cleared.data.latitude, cleared.data.longitude], [null, null, null])
  const bad = await prepareAddressData({ ...intl, mapsUrl: 'javascript:alert(1)' }) // jalur pemanggil yang melewati Zod tetap ditolak
  assert.equal(bad.ok, false)
})

await t('PENJAGA SUMBER: hanya route hotel memakai addressWithMapSchema; AddressPicker withMap hanya di editor hotel; halaman publik memeriksa ulang tautan', () => {
  const users = ['app/api/v1/auth/profile/route.ts', 'lib/validators/vendor.ts', 'lib/validators/invoiceSettings.ts', 'lib/validators/auth.ts']
  for (const f of users) assert.doesNotMatch(read(f), /addressWithMapSchema/, `${f}: alamat bukan hotel tak boleh menyimpan lokasi`)
  const hotelRoute = read('app/api/v1/admin/products/hotels/[id]/route.ts')
  assert.match(hotelRoute, /address:\s+addressWithMapSchema\.optional\(\),[^\n]*\n\}\)\.strict\(\)/, 'route hotel: skema ubah .strict() (SEC-162)')
  assert.match(read('app/[locale]/admin/(protected)/products/hotels/[id]/page.tsx'), /<AddressPicker [^>]*withMap/)
  const pub = read('app/[locale]/(public)/hotels/[id]/page.tsx')
  assert.match(pub, /parseMapsUrl\(hotelRaw\.address\.mapsUrl\)/)
  assert.match(pub, /rel="noopener noreferrer"/)
  assert.match(pub, /address: \{ select: \{ mapsUrl: true \} \}/, 'halaman publik hanya memuat tautan lokasi')
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
