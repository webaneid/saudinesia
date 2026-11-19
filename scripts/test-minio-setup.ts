// Penjaga SEC-305 (docs/lessons-learned.md): web memakai user MinIO APLIKASI berpolicy satu bucket, bukan root. Statis, tanpa MinIO.
// Perilaku setup.sh sungguhan (bucket privat, user dibuat/diperbarui, aksi admin ditolak) diuji manual atas server MinIO sekali pakai —
// lihat entri docs/decisions.md 2026-11-20 "Temuan go-live Low".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Pengurai YAML bawaan Bun (skrip ini selalu dijalankan `bun`); deklarasi lokal karena tsconfig tidak memuat tipe Bun.
declare const Bun: { YAML: { parse: (src: string) => unknown } }

let failed = 0
function t(name: string, fn: () => void) {
  try { fn(); console.log(`PASS ${name}`) } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 12).join('\n     ')}`)
  }
}

const read = (f: string) => readFileSync(f, 'utf8')
type Service = { image?: string; entrypoint?: string[]; environment?: Record<string, string>; depends_on?: Record<string, { condition: string }> }
const compose = Bun.YAML.parse(read('docker-compose.prod.yml')) as { services: Record<string, Service> }
const svc = (n: string) => { const s = compose.services[n]; assert.ok(s, `service ${n} tidak ada`); return s }
const dockerfile = read('infra/minio/Dockerfile')
const arg = (n: string) => new RegExp(`^ARG ${n}=(\\S+)$`, 'm').exec(dockerfile)?.[1]
const setup = read('infra/minio/setup.sh')

t('tag image minio & minio-setup = <MINIO_VERSION>-r<IMAGE_REV> dari infra/minio/Dockerfile', () => {
  const tag = `${arg('MINIO_VERSION')}-r${arg('IMAGE_REV')}`
  for (const n of ['minio', 'minio-setup']) assert.ok(svc(n).image?.endsWith(`/minio:${tag}`), `${n}: ${svc(n).image} ≠ ${tag}`)
  const wf = read('.github/workflows/minio-image.yml')
  assert.match(wf, /minio:\$\{\{ env\.MINIO_VERSION \}\}-r\$\{\{ env\.IMAGE_REV \}\}/)
})

t('image membawa mc + setup.sh', () => {
  assert.match(dockerfile, /go install github\.com\/minio\/mc@\$\{MC_VERSION\}/)
  assert.match(dockerfile, /COPY --chmod=0755 setup\.sh \/usr\/local\/bin\/minio-setup/)
  assert.deepEqual(svc('minio-setup').entrypoint, ['/usr/local/bin/minio-setup'])
})

t('root MinIO hanya di minio & minio-setup; web mengosongkannya dan menunggu minio-setup', () => {
  const minio = svc('minio').environment ?? {}
  assert.match(minio.MINIO_ROOT_USER ?? '', /^\$\{MINIO_ROOT_USER:\?/)
  assert.match(minio.MINIO_ROOT_PASSWORD ?? '', /^\$\{MINIO_ROOT_PASSWORD:\?/)
  const web = svc('web')
  assert.equal(web.environment?.MINIO_ROOT_USER, '')
  assert.equal(web.environment?.MINIO_ROOT_PASSWORD, '')
  assert.equal(web.depends_on?.['minio-setup']?.condition, 'service_completed_successfully')
  for (const [n, s] of Object.entries(compose.services)) {
    if (n === 'minio' || n === 'minio-setup' || n === 'web') continue
    assert.ok(!JSON.stringify(s.environment ?? {}).includes('MINIO_ROOT'), `${n} memegang root MinIO`)
  }
})

t('setup.sh: fail-closed bila kunci aplikasi = root, rahasia tak lewat argumen, bucket privat', () => {
  assert.match(setup, /\[ "\$MINIO_ACCESS_KEY" != "\$MINIO_ROOT_USER" \] \|\| \{/)
  assert.doesNotMatch(setup.split("\n").filter(l => !l.trimStart().startsWith("#")).join("\n"), /\bmc\b[^\n]*alias set/)
  assert.match(setup, /export MC_HOST_root=/)
  assert.match(setup, /printf '%s\\n' "\$MINIO_SECRET_KEY" \| mc --quiet admin user add root "\$MINIO_ACCESS_KEY"\n/)
  assert.match(setup, /mc --quiet anonymous set none "root\/\$BUCKET"/)
  assert.equal(spawnSync('sh', ['-n', 'infra/minio/setup.sh']).status, 0, 'sintaks sh')
})

t('policy user aplikasi = hanya objek & daftar satu bucket (tanpa wildcard/admin)', () => {
  const actions = [...setup.matchAll(/"Action": \[([^\]]*)\]/g)].flatMap(m => m[1]!.split(',').map(a => a.trim().replace(/"/g, '')))
  assert.deepEqual(actions.sort(), ['s3:DeleteObject', 's3:GetBucketLocation', 's3:GetObject', 's3:ListBucket', 's3:PutObject'])
  const resources = [...setup.matchAll(/"Resource": \[([^\]]*)\]/g)].map(m => m[1]!.trim())
  assert.deepEqual(resources, ['"arn:aws:s3:::$BUCKET"', '"arn:aws:s3:::$BUCKET/*"'])
})

t('buat-env-production.sh membuat root & kunci aplikasi yang berbeda', () => {
  const s = read('scripts/buat-env-production.sh')
  assert.match(s, /MINIO_ROOT_USER=root\$\(acak 6\)/)
  assert.match(s, /MINIO_ROOT_PASSWORD=\$\(acak 24\)/)
  assert.match(s, /MINIO_ACCESS_KEY=saudinesia\$\(acak 4\)/)
  const ex = read('.env.production.example')
  for (const k of ['MINIO_ROOT_USER', 'MINIO_ROOT_PASSWORD', 'MINIO_ACCESS_KEY', 'MINIO_SECRET_KEY']) assert.match(ex, new RegExp(`^${k}=$`, 'm'))
})

console.log(failed ? `${failed} GAGAL` : 'SEMUA LULUS')
if (failed) process.exit(1)
