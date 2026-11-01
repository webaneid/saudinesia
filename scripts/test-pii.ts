// Uji fondasi PII Fase 1 data jamaah (docs/arsitektur-jamaah.md §6, ADR-0005): validasi kunci (kosong/lemah/sama/ganda ditolak, pesan tanpa nilai kunci),
// AES-256-GCM (IV acak, ubah satu karakter / tukar tujuan / versi tak dikenal → ditolak, rotasi kunci), indeks HMAC (deterministik, berkunci, terpisah per tujuan),
// NIK & paspor (normalisasi, aturan keras vs petunjuk), samaran, dan penjaga sumber (cipher & env PII hanya di lib/pii). Murni — tidak menyentuh DB.
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { piiKeysProblem, requirePiiKeys } from '@/lib/pii/keys'
import { decryptPii, encryptPii, piiIndex } from '@/lib/pii/cipher'
import { maskPassport, NIK_MASK, needsReencrypt, nikHints, nikProblem, normalizeNik, normalizePassport, openNik, openPassport, passportIndex, PiiDecryptError, sealNik, sealPassport } from '@/lib/pii'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}
const hex = () => randomBytes(32).toString('hex')
const K1 = hex(), K2 = hex(), K3 = hex(), K4 = hex()
const base = { PII_INDEX_KEY: K1, PII_ENCRYPTION_KEY: K2, PII_ENCRYPTION_KEY_VERSION: '1', JWT_SECRET: hex() }
function useEnv(env: Record<string, string | undefined>) {
  for (const k of ['PII_INDEX_KEY', 'PII_ENCRYPTION_KEY', 'PII_ENCRYPTION_KEY_VERSION', 'PII_ENCRYPTION_KEYS_RETIRED', 'JWT_SECRET']) {
    if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]
  }
}
useEnv(base)
const NIK = normalizeNik('3201 0145 0890 0001')! // perempuan (45 = 5 + 40), lahir 05-08-90

await t('KUNCI: konfigurasi sah diterima; kosong / bukan hex / pendek / placeholder / entropi rendah ditolak', () => {
  assert.equal(piiKeysProblem(base), null)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: undefined })!, /PII_INDEX_KEY belum diisi/)
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY: '' })!, /PII_ENCRYPTION_KEY belum diisi/)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: 'replace_with_64_char_random_hex' })!, /64 karakter hex/)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: K1.slice(0, 62) })!, /64 karakter hex/)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: 'g'.repeat(64) })!, /64 karakter hex/)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: 'ab'.repeat(32) })!, /entropi/)
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: '0123456789abcdef'.repeat(4) })!, /entropi/, 'blok 16 berulang (SEC-166)')
  assert.match(piiKeysProblem({ ...base, PII_INDEX_KEY: '1f2e3d4c'.repeat(8) })!, /entropi/, 'blok 8 berulang')
  assert.equal(piiKeysProblem({ ...base, PII_INDEX_KEY: ` ${K1.toUpperCase()} ` }), null, 'huruf besar / spasi tepi dinormalkan')
})

await t('KUNCI: indeks = enkripsi, sama dengan JWT_SECRET, versi tak sah, daftar pensiun rusak/ganda/sama ditolak', () => {
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY: K1 })!, /harus berbeda/)
  assert.match(piiKeysProblem({ ...base, JWT_SECRET: K2 })!, /JWT_SECRET/)
  for (const v of ['0', '-1', '1.5', 'x']) assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: v })!, /VERSION/, v)
  assert.equal(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: undefined }), null, 'bawaan versi 1')
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEYS_RETIRED: K3 })!, /versi:hex/)
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEYS_RETIRED: `1:${K3}` })!, /ganda/, 'versi pensiun = versi tulis')
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: '3', PII_ENCRYPTION_KEYS_RETIRED: `1:${K3},1:${K4}` })!, /ganda/)
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: '2', PII_ENCRYPTION_KEYS_RETIRED: `1:${K2}` })!, /sama dengan kunci lain/)
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: '2', PII_ENCRYPTION_KEYS_RETIRED: `1:${K1}` })!, /sama dengan kunci lain/, 'kunci indeks tak boleh dipakai ulang')
  assert.match(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: '2', PII_ENCRYPTION_KEYS_RETIRED: `1:${base.JWT_SECRET}` })!, /sama dengan kunci lain/, 'kunci pensiun tak boleh = JWT_SECRET (SEC-166)')
  assert.equal(piiKeysProblem({ ...base, PII_ENCRYPTION_KEY_VERSION: '3', PII_ENCRYPTION_KEYS_RETIRED: `1:${K3}, 2:${K4}` }), null)
})

await t('KUNCI: requirePiiKeys melempar fail-closed, pesannya TIDAK memuat nilai kunci', () => {
  const bad = { ...base, PII_ENCRYPTION_KEY: K1 }
  assert.throws(() => requirePiiKeys(bad), (e: Error) => !e.message.includes(K1) && /berbeda/.test(e.message))
  const almost = K3.slice(0, 63)
  assert.throws(() => requirePiiKeys({ ...base, PII_INDEX_KEY: almost }), (e: Error) => !e.message.includes(almost))
  useEnv({ ...base, PII_INDEX_KEY: undefined })
  assert.throws(() => encryptPii('nik', NIK), /PII_INDEX_KEY/)
  assert.throws(() => piiIndex('nik', NIK), /PII_INDEX_KEY/)
  useEnv(base)
})

await t('CIPHER: bolak-balik; dua enkripsi nilai sama berbeda (IV acak); bentuk v1.<iv>.<isi>; kosong ditolak', () => {
  const a = encryptPii('nik', NIK), b = encryptPii('nik', NIK)
  assert.notEqual(a, b)
  assert.match(a, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/)
  assert.equal(decryptPii('nik', a), NIK)
  assert.ok(!a.includes(NIK) && !a.includes(NIK.slice(-4)), 'ciphertext tak memuat NIK')
  assert.throws(() => encryptPii('nik', ''), RangeError)
})

await t('CIPHER: ubah satu karakter isi / IV, tukar tujuan, versi tak dikenal, bentuk rusak → PiiDecryptError tanpa isi data', () => {
  const c = encryptPii('nik', NIK)
  const [v, iv, body] = c.split('.') as [string, string, string]
  const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1)
  const cases = [
    `${v}.${iv}.${flip(body, 3)}`, `${v}.${flip(iv, 3)}.${body}`, `${v}.${iv}.${body.slice(0, -4)}`,
    `v9.${iv}.${body}`, 'v1..', 'bukan-ciphertext', `${v}.${iv}`,
  ]
  for (const bad of cases) assert.throws(() => decryptPii('nik', bad), (e: Error) => e instanceof PiiDecryptError && !e.message.includes(NIK), bad)
  assert.throws(() => decryptPii('passport', c), PiiDecryptError, 'ciphertext NIK tak bisa dibuka sebagai paspor (AAD)')
  assert.throws(() => openPassport(c, { countryCode: 'ID', keyHash: piiIndex('passport', 'ID:X') }), PiiDecryptError)
})

await t('ROTASI: kunci lama di daftar pensiun tetap terbaca, tulisan baru memakai versi baru, needsReencrypt menandai yang lama; kunci lama dibuang → tak terbaca', () => {
  const old = encryptPii('nik', NIK)
  assert.equal(needsReencrypt(old), false)
  useEnv({ ...base, PII_ENCRYPTION_KEY: K3, PII_ENCRYPTION_KEY_VERSION: '2', PII_ENCRYPTION_KEYS_RETIRED: `1:${K2}` })
  assert.equal(decryptPii('nik', old), NIK)
  assert.equal(needsReencrypt(old), true)
  const fresh = encryptPii('nik', NIK)
  assert.match(fresh, /^v2\./); assert.equal(needsReencrypt(fresh), false)
  useEnv({ ...base, PII_ENCRYPTION_KEY: K3, PII_ENCRYPTION_KEY_VERSION: '2' })
  assert.throws(() => decryptPii('nik', old), /versi 1 tidak tersedia/)
  // Kunci salah di bawah nomor versi yang benar → autentikasi gagal, bukan data sampah.
  useEnv({ ...base, PII_ENCRYPTION_KEY: K4, PII_ENCRYPTION_KEY_VERSION: '2' })
  assert.throws(() => decryptPii('nik', fresh), /autentikasi gagal/)
  useEnv(base)
})

await t('INDEKS: deterministik, 64 hex, beda per tujuan dan per kunci, BUKAN SHA-256 polos; rotasi kunci enkripsi tak mengubah indeks', () => {
  const a = piiIndex('nik', NIK)
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.equal(piiIndex('nik', NIK), a)
  assert.notEqual(piiIndex('passport', NIK), a)
  assert.notEqual(a, createHash('sha256').update(NIK).digest('hex'))
  assert.notEqual(a, createHash('sha256').update(`nik:${NIK}`).digest('hex'))
  useEnv({ ...base, PII_ENCRYPTION_KEY: K3, PII_ENCRYPTION_KEY_VERSION: '2', PII_ENCRYPTION_KEYS_RETIRED: `1:${K2}` })
  assert.equal(piiIndex('nik', NIK), a, 'indeks hanya bergantung PII_INDEX_KEY')
  useEnv({ ...base, PII_INDEX_KEY: K4 })
  assert.notEqual(piiIndex('nik', NIK), a)
  useEnv(base)
})

await t('NIK: normalisasi tulisan KTP; 15/17 digit, huruf, provinsi 0x, urut 0000 ditolak', () => {
  assert.equal(normalizeNik('3201.0145.0890.0001'), '3201014508900001')
  assert.equal(normalizeNik(' 3201-0145-0890-0001 '), '3201014508900001')
  for (const bad of ['320101450890000', '32010145089000011', '3201O14508900001', '0201014508900001', '3201014508900000', '', '+3201014508900001']) {
    assert.equal(normalizeNik(bad), null, bad)
  }
  assert.equal(nikProblem('3201014508900001'), null)
  assert.match(nikProblem('12')!, /16 digit/)
})

await t('NIK: petunjuk tanggal lahir/jenis kelamin (perempuan +40) hanya peringatan; bagian tanggal mustahil ditandai', () => {
  assert.deepEqual(nikHints(NIK, { birthDate: '1990-08-05', gender: 'female' }), [])
  assert.deepEqual(nikHints(NIK, { birthDate: '1890-08-05', gender: 'female' }), [], 'abad tak dibandingkan (YY saja)')
  assert.deepEqual(nikHints(NIK, { birthDate: '1990-08-06', gender: 'female' }), ['birth_date_mismatch'])
  assert.deepEqual(nikHints(NIK, { birthDate: '1990-08-05', gender: 'male' }), ['gender_mismatch'])
  const male = normalizeNik('3201010508900001')!
  assert.deepEqual(nikHints(male, { birthDate: '1990-08-05', gender: 'male' }), [])
  assert.deepEqual(nikHints(male, {}), [])
  assert.deepEqual(nikHints(normalizeNik('3201010513900001')!, {}), ['date_part_invalid'], 'bulan 13')
  assert.deepEqual(nikHints(normalizeNik('3201013208900001')!, {}), ['date_part_invalid'], 'hari 32')
  assert.deepEqual(nikHints(NIK, { birthDate: 'bukan-tanggal' as never }), [])
})

await t('NIK: sealNik = indeks + ciphertext SAJA — tak ada digit NIK polos (SEC-165); openNik membuka dengan indeks barisnya', () => {
  const s = sealNik(NIK)
  assert.deepEqual(Object.keys(s).sort(), ['cipher', 'hash'])
  assert.equal(s.hash, piiIndex('nik', NIK))
  assert.ok(!s.cipher.includes(NIK.slice(-4)))
  assert.equal(openNik(s.cipher, s.hash), NIK)
  const p = sealPassport('ID', normalizePassport('A1234567')!)
  assert.throws(() => openNik(p.cipher, s.hash), PiiDecryptError)
})

await t('NIK/PASPOR: ciphertext yang disalin ke baris lain (indeks baris berbeda) ditolak; indeks rusak ditolak (SEC-167)', () => {
  const a = sealNik(NIK), b = sealNik(normalizeNik('3201010508900002')!)
  assert.throws(() => openNik(a.cipher, b.hash), /tidak cocok dengan indeks baris/)
  for (const bad of ['', 'x', a.hash.toUpperCase(), a.hash.slice(1)]) assert.throws(() => openNik(a.cipher, bad), PiiDecryptError, bad)
  const n = normalizePassport('A1234567')!
  const p = sealPassport('ID', n), q = sealPassport('ID', normalizePassport('B7654321')!)
  assert.equal(openPassport(p.cipher, { countryCode: 'ID', keyHash: p.keyHash }), n)
  assert.throws(() => openPassport(p.cipher, { countryCode: 'ID', keyHash: q.keyHash }), /tidak cocok/)
  assert.throws(() => openPassport(p.cipher, { countryCode: 'MY', keyHash: p.keyHash }), /tidak cocok/, 'negara lain = baris lain')
})

await t('PASPOR: normalisasi; terlalu pendek / simbol ditolak; indeks bergantung negara; negara tak dikenal ditolak; seal/open', () => {
  assert.equal(normalizePassport(' a12-345 67 '), 'A1234567')
  for (const bad of ['A12', 'A1234567/', 'Ä1234567', 'A'.repeat(21), '', 'ı1234567', 'A123456ß', 'ﬁ123456', 'A1234567\t', 'A１２３４５６７']) assert.equal(normalizePassport(bad), null, JSON.stringify(bad))
  const n = normalizePassport('A1234567')!
  assert.notEqual(passportIndex('ID', n), passportIndex('MY', n))
  assert.notEqual(passportIndex('ID', n), piiIndex('nik', n))
  for (const c of ['XX', 'id', 'IDN', '']) assert.throws(() => passportIndex(c, n), RangeError, c)
  const s = sealPassport('ID', n)
  assert.equal(s.last4, '4567'); assert.equal(openPassport(s.cipher, { countryCode: 'ID', keyHash: s.keyHash }), n)
})

await t('SAMARAN: NIK selalu tersamar penuh tanpa digit; paspor 4 karakter terakhir; masukan aneh → kosong (tak pernah nilai mentah)', () => {
  assert.ok(!/\d/.test(NIK_MASK))
  assert.equal(maskPassport('4567'), '••••4567')
  for (const bad of [null, undefined, '', '123', '12345', NIK, 'ab<1']) assert.equal(maskPassport(bad as string), '', String(bad))
})

await t('PENJAGA SUMBER: cipher, env PII, dan modul internal lib/pii hanya dipakai di lib/pii; lib/pii (selain mask) tak masuk komponen klien', () => {
  const root = new URL('..', import.meta.url).pathname
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  for (const d of ['app', 'lib', 'components']) walk(join(root, d))
  for (const f of ['middleware.ts', 'instrumentation.ts', 'instrumentation-node.ts']) files.push(join(root, f))
  assert.ok(files.length > 200, `hanya ${files.length} berkas — penjaga tak bermakna`)
  const bad: string[] = []
  for (const f of files) {
    const rel = relative(root, f)
    if (rel.startsWith('lib/pii/')) continue
    const src = readFileSync(f, 'utf8')
    if (/createCipheriv|createDecipheriv|['"]aes-\d{3}-/.test(src)) bad.push(`${rel}: memakai cipher di luar lib/pii`)
    if (/PII_(INDEX|ENCRYPTION)_KEY/.test(src)) bad.push(`${rel}: membaca env kunci PII di luar lib/pii`)
    if (/['"]@\/lib\/pii\/cipher['"]/.test(src)) bad.push(`${rel}: mengimpor lib/pii/cipher (pakai @/lib/pii)`)
    if (/['"]@\/lib\/pii\/keys['"]/.test(src) && rel !== 'instrumentation-node.ts') bad.push(`${rel}: mengimpor lib/pii/keys`)
    if (/^['"]use client['"]/m.test(src) && /['"]@\/lib\/pii['"]/.test(src)) bad.push(`${rel}: komponen klien mengimpor @/lib/pii (node:crypto) — pakai @/lib/pii/mask`)
  }
  assert.deepEqual(bad, [])
  assert.match(readFileSync(join(root, 'instrumentation-node.ts'), 'utf8'), /warnPiiKeysOnBoot\(\)/, 'peringatan boot harus terpasang')
  const gen = readFileSync(join(root, 'scripts/buat-env-production.sh'), 'utf8')
  assert.match(gen, /PII_INDEX_KEY=\$\(acak 32\)/); assert.match(gen, /PII_ENCRYPTION_KEY=\$\(acak 32\)/)
  const example = readFileSync(join(root, '.env.production.example'), 'utf8')
  assert.match(example, /^PII_INDEX_KEY=$/m); assert.match(example, /^PII_ENCRYPTION_KEY=$/m)
})

if (failed > 0) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nSemua uji PII lulus')
