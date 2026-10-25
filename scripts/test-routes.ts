// Penjaga regresi route handler (SEC-07, SEC-08; docs/lessons-learned.md). Memindai SEMUA app/api/**/route.ts — statis, tanpa
// database/Redis. Yang dikunci: route tidak boleh pura-pura sukses tanpa auth (stub, SEC-07), dan galat tidak boleh disamarkan
// jadi 403 (SEC-08).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { authFailureResponse, isAuthError, isRecordNotFound } from '../lib/admin/errors'
import { seasonCreateSchema } from '../lib/validators/adminUpdates'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`)
  }
}

const API = 'app/api'
const routes = (readdirSync(API, { recursive: true }) as string[])
  .filter(f => f.endsWith('route.ts'))
  .map(f => join(API, f))
  .sort()
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(API, f)

await t('pemindai menemukan route (bukan lulus karena direktori kosong)', () => {
  assert.ok(routes.length > 100, `hanya ${routes.length} route ditemukan`)
})

// Pemeriksaan auth yang dikenali. Route publik sengaja tidak memakainya, tetapi route publik tidak boleh menjawab `ok(null)`.
const AUTH_CALL = /\b(require(Session|Admin|Manager|SuperAdmin)|getSession|resolveSession|clearSession)\b/
// Satu-satunya route yang sah menjawab ok(null) tanpa pemeriksaan "siapa kamu": logout (memanggil clearSession, sudah ikut AUTH_CALL).
const STUB_ALLOWLIST = new Set<string>([])

await t('SEC-07: tidak ada route stub yang menjawab ok(null) tanpa pemeriksaan auth', () => {
  const stubs = routes.filter(f => {
    const src = read(f)
    return /\bok\(null\)/.test(src) && !AUTH_CALL.test(src) && !STUB_ALLOWLIST.has(rel(f))
  })
  assert.deepEqual(stubs.map(rel), [], 'route stub tanpa auth yang membalas sukses (hapus, atau beri auth + 501):')
})

await t('SEC-07: tidak ada route yang isinya hanya handler kosong ber-sukses (tanpa prisma/lib, tanpa auth)', () => {
  const hollow = routes.filter(f => {
    const src = read(f)
    const handlers = (src.match(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length
    const hasLogic = /\bprisma\b|@\/lib\/(?!validators)/.test(src)
    return handlers > 0 && !hasLogic && !AUTH_CALL.test(src)
  })
  assert.deepEqual(hollow.map(rel), [], 'route tanpa logika dan tanpa auth:')
})

// --- SEC-08 ---------------------------------------------------------------------------------------------------------------
/** Semua pasangan `try { … } catch { … }` dalam satu berkas (pencocokan kurung kurawal; cukup untuk gaya kode route di sini). */
function tryCatchBlocks(src: string): { line: number; tryBody: string; catchBody: string }[] {
  const out: { line: number; tryBody: string; catchBody: string }[] = []
  const closeOf = (text: string, from: number) => {
    let depth = 1
    let i = from
    while (i < text.length && depth > 0) {
      const c = text[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      i++
    }
    return i
  }
  for (const m of src.matchAll(/\btry\s*\{/g)) {
    const start = (m.index ?? 0) + m[0].length
    const end = closeOf(src, start)
    const rest = src.slice(end)
    const cm = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(rest)
    if (!cm) continue
    const cEnd = closeOf(rest, cm[0].length)
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      tryBody: src.slice(start, end - 1),
      catchBody: rest.slice(cm[0].length, cEnd - 1),
    })
  }
  return out
}

await t('SEC-08: tidak ada catch yang menjawab 403 tanpa jalur 500/log (galat DB/bug tidak boleh jadi "Forbidden")', () => {
  const bad: string[] = []
  for (const f of routes) {
    for (const b of tryCatchBlocks(read(f))) {
      const collapses = /\b403\b/.test(b.catchBody) && !/\b500\b/.test(b.catchBody) && !/console\.error/.test(b.catchBody)
      // `catch (e) { return authFailureResponse(e, …) }` sudah memetakan non-auth → 500, jadi tidak mengandung literal 403.
      if (collapses) bad.push(`${rel(f)}:${b.line}`)
    }
  }
  assert.deepEqual(bad, [], 'catch yang menyamarkan semua galat jadi 403 (pakai isAuthError/authFailureResponse dari lib/admin/errors):')
})

await t('SEC-08: tidak ada route yang membangun data dari body mentah (`const b = await req.json()`); pakai skema Zod', () => {
  const bad = routes.filter(f => /\bconst\s+b\s*=\s*await\s+(req|request)\.json\(\)/.test(read(f))).map(rel)
  assert.deepEqual(bad, [])
})

await t('SEC-61(b): GET vendor terbuka bagi manager TAPI hanya kolom pemilih; kontak/alamat & seluruh penulisan tetap superadmin', () => {
  const src = read(routes.find(f => rel(f).endsWith('admin/system/settings/vendors/route.ts')) ?? '')
  const get = src.slice(src.indexOf('export async function GET'), src.indexOf('export async function POST'))
  assert.match(get, /requireManager\(\)/)
  assert.doesNotMatch(get, /requireSuperAdmin\(\)/)
  assert.match(get, /select: \{ id: true, name: true, category: true, country: true, isActive: true \}/, 'cabang manager harus memakai select ramping')
  assert.doesNotMatch(get.slice(get.indexOf('const full')), /contactInfo|addressId/, 'kolom sensitif tak boleh ada di cabang non-superadmin')
  assert.match(src.slice(src.indexOf('export async function POST')), /requireSuperAdmin\(\)/)
  const byId = read(routes.find(f => rel(f).endsWith('admin/system/settings/vendors/[id]/route.ts')) ?? '')
  assert.ok(!/requireManager\(\)/.test(byId) && /requireSuperAdmin\(\)/.test(byId), 'PUT/DELETE vendor tetap superadmin')
})

await t('SEC-50: health — sehat di-cache 5 dtk dan permintaan bersamaan berbagi satu query; gagal TIDAK di-cache (503 lalu pulih)', async () => {
  const { prisma } = await import('../lib/db')
  const { GET } = await import('../app/api/v1/health/route')
  const db = prisma.user as unknown as { findFirst: (...a: unknown[]) => Promise<unknown> }
  const realFind = db.findFirst, realNow = Date.now
  let calls = 0, fail = false, clock = realNow()
  Date.now = () => clock
  db.findFirst = async () => { calls++; if (fail) throw new Error('db down'); return null }
  try {
    const burst = await Promise.all(Array.from({ length: 20 }, () => GET()))
    assert.ok(burst.every(r => r.status === 200)); assert.equal(calls, 1, '20 permintaan bersamaan → 1 query')
    clock += 4_000; assert.equal((await GET()).status, 200); assert.equal(calls, 1, 'dalam TTL tak ada query baru')
    clock += 1_500; assert.equal((await GET()).status, 200); assert.equal(calls, 2, 'lewat TTL → query lagi')
    clock += 6_000; fail = true
    assert.equal((await GET()).status, 503); assert.equal((await GET()).status, 503); assert.equal(calls, 4, 'kegagalan tidak di-cache')
    fail = false; assert.equal((await GET()).status, 200, 'pulih begitu DB kembali')
    assert.deepEqual(await (await GET()).json(), { success: true, data: { status: 'ok' } }, 'tanpa detail tambahan')
  } finally {
    db.findFirst = realFind; Date.now = realNow
  }
})

await t('SEC-50: katalog flight memetakan field eksplisit — kolom kuota internal tidak ikut, availableSeats ikut', () => {
  const src = read(routes.find(f => rel(f).endsWith('v1/catalog/flight/route.ts')) ?? '')
  assert.match(src, /availableSeats: Math\.max\(0, s\.totalSeats - s\.pendingSeats - s\.bookedSeats\)/)
  assert.doesNotMatch(src, /\.\.\.s\b/, 'jangan menyebar baris DB mentah ke respons publik')
  assert.doesNotMatch(src, /(?<!s\.)(totalSeats|pendingSeats|bookedSeats):/, 'kolom kuota mentah tak boleh jadi kunci respons')
})

await t('SEC-49: setiap `req.json()` diberi `.catch` — body rusak/kosong harus 400, bukan 500', () => {
  const bad: string[] = []
  for (const f of routes) {
    read(f).split('\n').forEach((line, i) => {
      if (/\b(req|request)\.json\(\)(?!\s*\.catch\()/.test(line) && !/^\s*\/\//.test(line)) bad.push(`${rel(f)}:${i + 1}`)
    })
  }
  assert.deepEqual(bad, [], 'req.json() tanpa .catch(() => null) — SyntaxError dari body rusak jatuh ke catch umum → 500:')
})

await t('SEC-62: DELETE images (hotel/kendaraan) hanya menghapus key yang tercatat pada entitas itu — cek keanggotaan SEBELUM deleteObject', () => {
  for (const suffix of ['hotels/[id]/images/route.ts', 'transport/vehicles/[id]/images/route.ts']) {
    const src = read(routes.find(f => rel(f).endsWith(suffix)) ?? '')
    const del = src.slice(src.indexOf('export async function DELETE'))
    const member = del.indexOf('current.includes(key)'), remove = del.indexOf('deleteObject(key)')
    assert.ok(member > 0 && remove > 0, `${suffix}: cek keanggotaan / deleteObject tidak ditemukan`)
    assert.ok(member < remove, `${suffix}: cek keanggotaan harus mendahului deleteObject`)
  }
  // Satu-satunya pemanggil deleteObject dengan key dari klien adalah dua route ini; sisanya memakai key dari DB.
  const fromClient = routes.filter(f => /deleteObject\(\s*key\s*\)/.test(read(f))).map(rel).sort()
  assert.deepEqual(fromClient, ['v1/admin/products/hotels/[id]/images/route.ts', 'v1/admin/products/transport/vehicles/[id]/images/route.ts'])
})

await t('SEC-61(b)/UI: setiap tombol "tambah vendor cepat" menampilkan galat lewat vendorQuickAddError (tak boleh senyap saat 403 bagi manager)', () => {
  const dir = 'app/[locale]/admin/(protected)/products'
  const files = ['transport/trips/[id]/page.tsx', 'hotels/[id]/page.tsx', 'flight/[id]/page.tsx', 'tour-packages/[id]/page.tsx', 'packages/[id]/page.tsx', 'visa/[id]/CostTiersTab.tsx']
  for (const f of files) {
    const src = read(join(dir, f))
    assert.match(src, /vendorQuickAddError\(r\.status, j\?\.error\)/, `${f}: galat tambah-vendor tidak ditampilkan`)
    assert.ok(src.includes("settings/vendors', {") , `${f}: pemanggil POST vendor tidak ditemukan — daftar berkas uji perlu diperbarui`)
  }
  const all = readdirSync(dir, { recursive: true }) as string[]
  const callers = all.filter(f => /\.tsx$/.test(f) && read(join(dir, f)).includes("fetch('/api/v1/admin/system/settings/vendors', {")).sort()
  assert.deepEqual(callers, [...files].sort(), 'ada pemanggil POST vendor baru di halaman produk yang belum memakai vendorQuickAddError')
})

await t('SEC-11: semua `uses:` di workflow dipin ke SHA commit 40 hex (tag bisa dipindah), dan bun-version bukan `latest`', () => {
  const dir = '.github/workflows'
  const files = (readdirSync(dir) as string[]).filter(f => /\.ya?ml$/.test(f))
  assert.ok(files.length >= 2, 'workflow tidak ditemukan — penjaga ini tak bermakna')
  const bad: string[] = []
  for (const f of files) {
    read(join(dir, f)).split('\n').forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/)
      if (m && !m[1]!.startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1]!)) bad.push(`${f}:${i + 1} ${m[1]}`)
      if (/bun-version:\s*latest\b/.test(line)) bad.push(`${f}:${i + 1} bun-version latest`)
    })
  }
  assert.deepEqual(bad, [], 'action belum dipin ke SHA / Bun tidak dipin (rantai pasok CI):')
})

await t('SEC-47: /address — GET/PUT lewat canAccessAddress (BOLA), POST dibatasi addressCreateUser, body rusak tidak 500', () => {
  const byId = read(routes.find(f => rel(f).endsWith('v1/address/[id]/route.ts')) ?? '')
  for (const verb of ['GET', 'PUT']) {
    const start = byId.indexOf(`export async function ${verb}`)
    const block = byId.slice(start, start + 700)
    assert.match(block, /canAccessAddress\(session, id\)/, `${verb} harus memeriksa kepemilikan`)
    assert.match(block, /const session = await requireSession\(\)/)
  }
  assert.match(byId, /isRecordNotFound\(e\)/)
  const root = read(routes.find(f => rel(f).endsWith('v1/address/route.ts')) ?? '')
  assert.match(root, /consume\(policy\('addressCreateUser', session\.userId\)\)/)
  assert.match(root, /req\.json\(\)\.catch\(/)
  const access = read('lib/address/access.ts')
  assert.match(access, /ADMIN_ROLES\.includes\(session\.role\)/)
  assert.match(access, /me\?\.addressId === addressId/)
})

await t('helper galat: authFailureResponse — auth → 403; selain itu → 500 tanpa membocorkan pesan; isRecordNotFound hanya P2025', async () => {
  const origError = console.error
  console.error = () => {}
  try {
    for (const msg of ['Unauthorized', 'Forbidden']) {
      const r = authFailureResponse(new Error(msg), 'uji')
      assert.equal(r.status, 403)
      assert.deepEqual(await r.json(), { success: false, error: 'Forbidden' })
    }
    const r500 = authFailureResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'), 'uji')
    assert.equal(r500.status, 500)
    const body = JSON.stringify(await r500.json())
    assert.doesNotMatch(body, /ECONNREFUSED|10\.0\.0\.5/)
    assert.equal(authFailureResponse('bukan Error', 'uji').status, 500)
  } finally {
    console.error = origError
  }
  assert.equal(isAuthError(new Error('Forbidden')), true)
  assert.equal(isAuthError(new Error('lain')), false)
  assert.equal(isRecordNotFound({ code: 'P2025' }), true)
  assert.equal(isRecordNotFound({ code: 'P2002' }), false)
  assert.equal(isRecordNotFound(null), false)
})

await t('skema musim: payload form admin lolos; nama liar, tanggal rusak, akhir < awal, kunci liar, body kosong ditolak', () => {
  const ok = { name: 'ramadan', startDate: '2027-02-18', endDate: '2027-03-19' }
  const parsed = seasonCreateSchema.safeParse(ok)
  assert.equal(parsed.success, true)
  if (parsed.success) assert.ok(parsed.data.startDate instanceof Date && parsed.data.endDate instanceof Date)
  assert.equal(seasonCreateSchema.safeParse({ ...ok, endDate: ok.startDate }).success, true) // satu hari sah
  assert.equal(seasonCreateSchema.safeParse({ ...ok, name: 'musim_panas' }).success, false)
  assert.equal(seasonCreateSchema.safeParse({ ...ok, startDate: '' }).success, false)
  assert.equal(seasonCreateSchema.safeParse({ ...ok, startDate: '18/02/2027' }).success, false)
  assert.equal(seasonCreateSchema.safeParse({ ...ok, startDate: '2027-13-45' }).success, false)
  assert.equal(seasonCreateSchema.safeParse({ ...ok, startDate: '2027-04-01' }).success, false) // akhir < awal
  assert.equal(seasonCreateSchema.safeParse({ ...ok, id: 'x' }).success, false)
  assert.equal(seasonCreateSchema.safeParse(null).success, false)
})

console.log(failed ? `\n${failed} GAGAL` : '\nSEMUA LULUS')
process.exit(failed ? 1 : 0)
