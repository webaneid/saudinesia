// Penjaga keterjangkauan advisory dependensi yang DITERIMA (bukan ditambal) — docs/lessons-learned.md.
// Penerimaan risiko hanya sah selama alasannya tetap benar; tes ini merah begitu alasannya basi (mis. sesudah `minio`/`query-string` naik).
//
// SEC-308: decode-uri-component@0.2.x (GHSA-qr28-fpjm-wq7f, GHSA-vcc3-ghjq-m6fr) hanya ada lewat minio › query-string@7. Versi tambalan
// (0.5.x) ESM-only, sedangkan query-string@7 memanggilnya dengan require() CJS — override akan merusak SDK MinIO. Fungsi rentan hanya
// dipanggil `decode()` query-string, dan `decode()` hanya dipakai parse/parseUrl/pick/exclude. Minio hanya memakai `stringify`, kode kita
// tidak memakai keduanya → tak terjangkau.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(c|m)?js$/.test(n)) out.push(p)
  }
  return out
}

console.log('== SEC-308: decode-uri-component tak terjangkau ==')
t('lockfile: decode-uri-component hanya dependensi query-string, query-string hanya dependensi minio', () => {
  const lock = readFileSync('bun.lock', 'utf8')
  // Baris paket yang MENYEBUT nama itu di dependencies-nya (selain definisi paketnya sendiri).
  const dependents = (name: string) => lock.split('\n')
    .filter(l => l.includes(`"${name}": "`) && !l.trimStart().startsWith(`"${name}": [`))
    .map(l => l.trim().match(/^"([^"]+)": \["([^"]+)"/)?.[2] ?? l.trim().slice(0, 60))
  assert.deepEqual(dependents('decode-uri-component'), [dependents('decode-uri-component').find(d => d.startsWith('query-string@7.'))].filter(Boolean))
  assert.equal(dependents('decode-uri-component').length, 1, `pemakai lain: ${dependents('decode-uri-component').join(', ')}`)
  const qs = dependents('query-string')
  assert.equal(qs.length, 1, `pemakai query-string: ${qs.join(', ')}`)
  assert.match(qs[0]!, /^minio@8\./)
})
t('query-string@7: stringify tidak memanggil decode(); decode() satu-satunya pemakai decode-uri-component', () => {
  const pkg = JSON.parse(readFileSync('node_modules/query-string/package.json', 'utf8')) as { version: string }
  assert.match(pkg.version, /^7\./, 'query-string berganti mayor — tinjau ulang SEC-308')
  const src = readFileSync('node_modules/query-string/index.js', 'utf8')
  assert.equal([...src.matchAll(/decodeComponent\(/g)].length, 1, 'decodeComponent dipanggil di lebih dari satu tempat')
  const start = src.indexOf('exports.stringify = ')
  const end = src.indexOf('exports.parseUrl = ')
  assert.ok(start > 0 && end > start)
  assert.doesNotMatch(src.slice(start, end), /\bdecode\(|\bparse\(/, 'stringify kini memanggil decode/parse')
})
t('minio (main + esm): setiap pemakaian query-string hanya .stringify', () => {
  const files = walk('node_modules/minio/dist').filter(f => readFileSync(f, 'utf8').includes('query-string'))
  assert.ok(files.length >= 2, 'tak menemukan pemakaian query-string di minio — struktur berubah, tinjau ulang')
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const names = [...src.matchAll(/(?:var|const|let)\s+(\w+)\s*=\s*[^;\n]*require\("query-string"\)|import\s+\*\s+as\s+(\w+)\s+from\s+'query-string'/g)].map(m => m[1] ?? m[2]!)
    assert.ok(names.length > 0, `${f}: query-string diimpor dengan bentuk tak dikenal`)
    for (const n of names) {
      const uses = [...src.matchAll(new RegExp(`\\b${n}\\b(\\.\\w+)?`, 'g'))].map(m => m[1] ?? '(tanpa anggota)')
      const other = uses.filter((u, i) => i > 0 && u !== '.stringify') // kemunculan pertama = deklarasi impor
      assert.deepEqual(other, [], `${f}: ${n} dipakai selain stringify`)
    }
  }
})
t('kode aplikasi tidak mengimpor query-string / decode-uri-component', () => {
  let hits = ''
  try { hits = execFileSync('git', ['grep', '-nE', `(from|require\\()\\s*['"](query-string|decode-uri-component)['"]`, '--', 'app', 'lib', 'components', 'middleware.ts', 'instrumentation.ts', 'instrumentation-node.ts', 'prisma'], { encoding: 'utf8' }) } catch { hits = '' }
  assert.equal(hits.trim(), '')
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
