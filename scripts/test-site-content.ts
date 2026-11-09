// Konten Situs (docs/arsitektur-frontend-publik.md §6.5). Bagian 1 murni (registry, validator, penggabungan); bagian 2 menulis ke DB sekali pakai
// (simpan, versi basi 409, jejak, kembalikan ke bawaan); bagian 3 penemu sumber (satu penulis, satu pembaca, route superadmin).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { editableFields, isIcuText, linkSlots, PUBLIC_PAGE_KEYS, PUBLIC_PAGES } from '@/lib/public-content/pages'
import { pageContentInputSchema } from '@/lib/validators/publicContent'
import { contentChanges, normalizeInput, parseStoredContent, savePageContent, getPageForAdmin } from '@/lib/public-content/service'
import { targetHref } from '@/lib/public-content/links'
import { assertThrowawayDb } from './lib/testDb'

let failed = 0
async function t(name: string, fn: () => unknown) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 10).join('\n     ')}`) }
}
const now = new Date().toISOString()
const input = (o: Partial<{ text: unknown; links: unknown; expectedUpdatedAt: unknown }>) => ({ text: {}, links: {}, expectedUpdatedAt: now, ...o })

// ── 1. Murni ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

await t('kolom yang bisa diedit diturunkan dari pesan; teks ICU tidak termasuk', () => {
  for (const page of PUBLIC_PAGE_KEYS) {
    const keys = editableFields(page).map(f => f.key)
    for (const k of ['hero.title', 'cta.title', 'meta.title']) assert.ok(keys.includes(k), `${page}: ${k}`)
    for (const f of editableFields(page)) assert.ok(!isIcuText(f.defaults.id) && !isIcuText(f.defaults.en), `${page}: ${f.key} ICU`)
    for (const s of linkSlots(page)) assert.ok(keys.includes(s.labelKey), `${page}: label tombol ${s.slot} tak bisa diedit`)
  }
  assert.ok(!editableFields('packages').some(f => f.key === 'facts.count'), 'facts.count (ICU) tidak boleh bisa diedit')
  assert.ok(editableFields('home').some(f => f.key === 'services.items.packages'), 'teks bersarang ikut bisa diedit')
})

await t('tujuan bawaan tombol ada di daftar putih', () => {
  for (const page of PUBLIC_PAGE_KEYS) for (const s of linkSlots(page)) targetHref('id', s.target)
  assert.ok(PUBLIC_PAGE_KEYS.every(k => /^[a-z][a-z0-9_]*$/.test(k)), 'kunci halaman = CHECK DB')
})

await t('validator menolak bentuk berbahaya atau berlebih', () => {
  const bad: [string, unknown][] = [
    ['field asing', { ...input({}), extra: 1 }],
    ['locale asing', input({ text: { fr: { 'hero.title': 'x' } } })],
    ['teks terlalu panjang', input({ text: { id: { 'hero.title': 'x'.repeat(401) } } })],
    ['karakter kontrol', input({ text: { id: { 'hero.title': 'a\u0000b' } } })],
    ['kunci berawalan titik', input({ text: { id: { '.hero': 'x' } } })],
    ['kunci dengan spasi', input({ text: { id: { 'hero title': 'x' } } })],
    ['tujuan luar', input({ links: { 'hero.primary': 'https://contoh.test' } })],
    ['tujuan protokol relatif', input({ links: { 'hero.primary': '//contoh.test' } })],
    ['tujuan javascript', input({ links: { 'hero.primary': 'javascript:alert(1)' } })],
    ['tujuan admin', input({ links: { 'hero.primary': 'admin' } })],
    ['teks bukan string', input({ text: { id: { 'hero.title': 5 } } })],
    ['tanpa versi', { text: {}, links: {} }],
    ['terlalu banyak kolom', input({ text: { id: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`k${i}`, 'x'])) } })],
  ]
  for (const [name, v] of bad) assert.equal(pageContentInputSchema.safeParse(v).success, false, name)
  assert.ok(pageContentInputSchema.safeParse(input({ text: { id: { 'hero.title': 'Baris\nkedua' } }, links: { 'hero.primary': null, 'cta.primary': '' } })).success)
})

await t('kunci __proto__ dari JSON dibuang tanpa mencemari prototipe', () => {
  const raw = JSON.parse(`{"text":{"id":{"__proto__":{"polluted":1}}},"links":{"__proto__":"register"},"expectedUpdatedAt":"${now}"}`)
  const r = pageContentInputSchema.safeParse(raw)
  if (r.success) {
    assert.deepEqual(Object.keys(r.data.text.id ?? {}), [])
    assert.deepEqual(Object.keys(r.data.links), [])
    assert.equal(Object.getPrototypeOf(r.data.links), Object.prototype)
  }
  assert.equal(({} as Record<string, unknown>).polluted, undefined)
})

await t('normalisasi: kolom di luar halaman ditolak, kosong dibuang, teks dipangkas', () => {
  const ok = normalizeInput('home', { text: { id: { 'hero.title': '  Judul  ', 'hero.subtitle': '   ' } }, links: { 'hero.secondary': null } })
  assert.deepEqual(ok, { text: { id: { 'hero.title': 'Judul' } }, links: { 'hero.secondary': null } })
  assert.equal((normalizeInput('home', { text: { id: { 'facts.count': 'x' } }, links: {} }) as { status?: number }).status, 400, 'kolom halaman lain')
  assert.equal((normalizeInput('packages', { text: { en: { 'services.title': 'x' } }, links: {} }) as { status?: number }).status, 400, 'kolom milik beranda')
  assert.equal((normalizeInput('home', { text: {}, links: { 'footer.primary': 'register' } }) as { status?: number }).status, 400, 'tombol tak ada')
})

await t('isi tersimpan yang rusak/asing dibuang, tidak merusak halaman', () => {
  assert.deepEqual(parseStoredContent('home', null), { text: {}, links: {} })
  assert.deepEqual(parseStoredContent('home', { text: { id: { 'hero.title': 'A', 'x.y': 'B', 'cta.title': 7 }, fr: { 'hero.title': 'C' } }, links: { 'hero.primary': null, 'z': 'register' } }),
    { text: { id: { 'hero.title': 'A' } }, links: { 'hero.primary': null } })
})

await t('jejak hanya mencatat yang berubah', () => {
  const a = { text: { id: { 'hero.title': 'A' } }, links: { 'hero.primary': 'visa' } }
  const b = { text: { id: { 'hero.title': 'A', 'cta.title': 'B' } }, links: { 'hero.primary': null } }
  assert.deepEqual(contentChanges(a, b), { 'id:cta.title': ['(bawaan)', 'B'], 'link:hero.primary': ['visa', '(disembunyikan)'] })
  assert.deepEqual(contentChanges(a, a), {})
})

// ── 3. Penemu sumber ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const walk = (dir: string): string[] => readdirSync(join(root, dir)).flatMap(f => {
  const p = join(dir, f)
  return statSync(join(root, p)).isDirectory() ? (f === 'node_modules' || f.startsWith('.') ? [] : walk(p)) : /\.tsx?$/.test(f) ? [p] : []
})
const sources = [...walk('app'), ...walk('lib'), ...walk('components')]

await t('satu penulis public_page_contents (lib/public-content/service.ts)', () => {
  const writers = sources.filter(f => /publicPageContent\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\b|public_page_contents/.test(readFileSync(join(root, f), 'utf8')))
  assert.deepEqual(writers, ['lib/public-content/service.ts'])
})

await t('halaman publik membaca teksnya lewat getPageText, bukan getTranslations atas namespace halaman', () => {
  const nss = Object.values(PUBLIC_PAGES).map(p => p.ns)
  const offenders = sources.filter(f => f.startsWith('app/[locale]/(public)') || f.startsWith('components/shared/public')).filter(f => {
    const src = readFileSync(join(root, f), 'utf8')
    return nss.some(ns => new RegExp(`namespace: ['\`]${ns.replace('.', '\\.')}[.'\`]`).test(src))
  })
  assert.deepEqual(offenders, [])
})

await t('route Konten Situs memanggil requireSuperAdmin dan memvalidasi dengan Zod', () => {
  const dir = 'app/api/v1/admin/system/site-content'
  const files = walk(dir).filter(f => f.endsWith('route.ts'))
  assert.equal(files.length, 2)
  for (const f of files) {
    const src = readFileSync(join(root, f), 'utf8')
    const handlers = src.match(/export async function (GET|PUT|POST|PATCH|DELETE)/g) ?? []
    assert.equal((src.match(/await requireSuperAdmin\(\)/g) ?? []).length, handlers.length, `${f}: tiap handler wajib requireSuperAdmin`)
    if (src.includes('PUT')) assert.match(src, /pageContentInputSchema\.safeParse/)
  }
  for (const f of walk('app/[locale]/admin/(protected)/system/site-content').filter(f => f.endsWith('page.tsx'))) {
    assert.match(readFileSync(join(root, f), 'utf8'), /requireAdminPage\(locale\)[\s\S]*SUPERADMIN_ROLES/, f)
  }
})

// ── 2. DB sekali pakai ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

await assertThrowawayDb()
const staff = await prisma.user.create({ data: { email: `konten-${Date.now()}@example.test`, fullName: 'Uji Konten', role: 'superadmin', passwordHash: 'x' }, select: { id: true } })

await t('simpan, baca ulang, versi basi 409, jejak, kembalikan ke bawaan', async () => {
  const first = await getPageForAdmin('packages')
  const saved = await savePageContent('packages', { text: { id: { 'hero.title': 'Judul baru' } }, links: { 'hero.secondary': null }, expectedUpdatedAt: first.updatedAt }, staff.id)
  assert.equal(saved.ok, true)
  const after = await getPageForAdmin('packages')
  assert.deepEqual(after.content, { text: { id: { 'hero.title': 'Judul baru' } }, links: { 'hero.secondary': null } })

  const stale = await savePageContent('packages', { text: {}, links: {}, expectedUpdatedAt: first.updatedAt }, staff.id)
  assert.deepEqual(stale.ok === false && stale.status, 409, 'versi basi harus 409')
  assert.deepEqual((await getPageForAdmin('packages')).content, after.content, 'versi basi tak boleh menimpa')

  const audits = await prisma.settingsAudit.findMany({ where: { entity: 'public_page', entityId: first.id }, orderBy: { at: 'asc' } })
  assert.equal(audits.length, 1)
  assert.equal(audits[0]!.staffId, staff.id)
  assert.deepEqual((audits[0]!.summary as { changes: unknown }).changes, { 'id:hero.title': ['(bawaan)', 'Judul baru'], 'link:hero.secondary': ['(bawaan)', '(disembunyikan)'] })

  const reset = await savePageContent('packages', { text: {}, links: {}, expectedUpdatedAt: after.updatedAt }, staff.id)
  assert.equal(reset.ok, true)
  assert.deepEqual((await getPageForAdmin('packages')).content, { text: {}, links: {} })
  assert.equal(await prisma.settingsAudit.count({ where: { entity: 'public_page', entityId: first.id } }), 2)
  assert.equal(await prisma.publicPageContent.count({ where: { pageKey: 'packages' } }), 1, 'kembalikan ke bawaan tidak menghapus baris (id foto hero tetap)')
})

await t('DB menolak isi bukan objek dan kunci halaman tak lazim', async () => {
  await assert.rejects(prisma.$executeRaw`UPDATE public_page_contents SET content = '[]'::jsonb WHERE "pageKey" = 'home'`)
  await assert.rejects(prisma.$executeRaw`INSERT INTO public_page_contents (id, "pageKey", "updatedAt") VALUES (gen_random_uuid()::text, 'Bad Key', timezone('UTC', now()))`)
})

await prisma.user.delete({ where: { id: staff.id } }).catch(() => undefined)
await prisma.$disconnect()
if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua lolos')
