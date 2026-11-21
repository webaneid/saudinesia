// Penjaga workflow deploy (.github/workflows/deploy.yml) dan skrip server (scripts/deploy-server.sh). Tanpa database/Docker:
// skrip server dijalankan sungguhan dengan `docker` TIRUAN di PATH yang mencatat setiap panggilan, jadi URUTAN langkahnya terbukti.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

declare const Bun: { YAML: { parse(s: string): unknown } }

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 8).join('\n     ')}`) }
}

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, string>; env?: Record<string, string> }
type Job = { needs?: string[] | string; if?: string; environment?: string; steps: Step[] }
const src = readFileSync('.github/workflows/deploy.yml', 'utf8')
const wf = Bun.YAML.parse(src) as { on: Record<string, unknown>; permissions: Record<string, string>; concurrency: { 'cancel-in-progress': boolean }; jobs: Record<string, Job & { permissions?: Record<string, string> }> }

console.log('== deploy.yml ==')
await t('pemicu manual saja, izin minimum, satu deploy pada satu waktu tanpa pembatalan', () => {
  assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch'])
  assert.deepEqual(wf.permissions, { contents: 'read' })
  assert.deepEqual(wf.jobs.build!.permissions, { contents: 'read', packages: 'write' })
  // Token yang dikirim ke server hanya bisa membaca paket.
  assert.deepEqual(wf.jobs.deploy!.permissions, { contents: 'read', packages: 'read' })
  assert.equal(wf.jobs.prepare!.permissions, undefined)
  assert.equal(wf.concurrency['cancel-in-progress'], false)
  assert.doesNotMatch(src, /pull_request_target/)
})
await t('masukan pengguna tak pernah diinterpolasi ke skrip shell (run/script) — hanya lewat env lalu divalidasi', () => {
  for (const [name, job] of Object.entries(wf.jobs)) for (const s of job.steps) {
    const code = `${s.run ?? ''}\n${s.with?.script ?? ''}`
    assert.doesNotMatch(code, /\$\{\{\s*(inputs|github\.event)\./, `${name}/${s.name}`)
    assert.doesNotMatch(code, /\$\{\{\s*secrets\./, `${name}/${s.name}: rahasia di skrip`)
  }
  assert.match(src, /\^sha-\[0-9a-f\]\{12\}\$/)
})
await t('SSH/SCP: kunci host dipin (fingerprint), token GHCR lewat envs, skrip server versi yang dideploy', () => {
  const ssh = Object.values(wf.jobs).flatMap(j => j.steps).filter(s => s.uses?.startsWith('appleboy/'))
  assert.equal(ssh.length, 2)
  for (const s of ssh) assert.equal(s.with?.fingerprint, '${{ secrets.SERVER_SSH_FINGERPRINT }}', s.name)
  const run = ssh.find(s => s.uses?.startsWith('appleboy/ssh-action'))!
  assert.equal(run.with?.script, 'bash /opt/app/scripts/deploy-server.sh')
  assert.match(run.with?.envs ?? '', /GHCR_TOKEN/)
  const scp = ssh.find(s => s.uses?.startsWith('appleboy/scp-action'))!
  for (const f of ['docker-compose.prod.yml', 'Caddyfile', 'scripts/deploy-server.sh', 'scripts/lengkapi-env-production.sh']) assert.ok((scp.with?.source ?? '').split(',').includes(f), f)
})
await t('build: NEXT_PUBLIC_APP_URL & MINIO wajib diperiksa sebelum build; web=runner, migrate=migrate; deploy menunggu build/rollback', () => {
  const b = wf.jobs.build!
  const names = b.steps.map(s => s.name ?? s.uses)
  assert.ok(names.indexOf('Periksa variabel build') < names.indexOf('Build & push web'))
  const web = b.steps.find(s => s.name === 'Build & push web')!
  assert.equal(web.with?.target, 'runner')
  for (const a of readFileSync('Dockerfile', 'utf8').matchAll(/^ARG (NEXT_PUBLIC_[A-Z0-9_]+)=/gm)) assert.match(web.with?.['build-args'] ?? '', new RegExp(`^${a[1]}=\\$\\{\\{ vars\\.${a[1]} \\}\\}$`, 'm'), `build-arg ${a[1]}`)
  assert.equal(b.steps.find(s => s.name === 'Build & push migrate')?.with?.target, 'migrate')
  assert.equal(b.environment, 'production'); assert.equal(wf.jobs.deploy!.environment, 'production')
  assert.match(wf.jobs.deploy!.if ?? '', /needs\.build\.result == 'skipped'/)
})

console.log('== scripts/deploy-server.sh (docker tiruan) ==')
const script = resolve('scripts/deploy-server.sh')
function sandbox(opts: { env?: boolean; mode?: number; running?: boolean; fail?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-'))
  const bin = join(dir, 'bin'); spawnSync('mkdir', ['-p', bin])
  const log = join(dir, 'docker.log')
  // Tiruan: catat argumen; `ps -q postgres` → ada id bila "running"; pg_dump → isi; gagal pada pola `fail`.
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
${opts.fail ? `[[ "$*" == *"${opts.fail}"* ]] && exit 1` : ''}
[[ "$*" == *"ps -q postgres"* ]] && { ${opts.running ? 'echo abc123' : 'true'}; exit 0; }
[[ "$*" == *"pg_dump"* ]] && { echo DUMPDATA; exit 0; }
exit 0
`)
  chmodSync(join(bin, 'docker'), 0o755)
  if (opts.env !== false) { writeFileSync(join(dir, '.env.production'), 'X=1\n'); chmodSync(join(dir, '.env.production'), opts.mode ?? 0o600) }
  if (opts.running) writeFileSync(join(dir, '.env.deploy'), 'GITHUB_REPO=webaneid/saudinesia\nIMAGE_TAG=sha-000000000000\n')
  return { dir, log, bin }
}
function run(box: ReturnType<typeof sandbox>, env: Record<string, string>) {
  const r = spawnSync('bash', [script], { env: { PATH: `${box.bin}:/usr/bin:/bin`, APP_DIR: box.dir, ...env } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: existsSync(box.log) ? readFileSync(box.log, 'utf8').trim().split('\n') : [] }
}
const OK = { DEPLOY_REPO: 'webaneid/saudinesia', DEPLOY_TAG: 'sha-1a2b3c4d5e6f', GHCR_USER: 'bot', GHCR_TOKEN: 'rahasia-token-uji' }

await t('masukan tak sah / .env.production hilang / izin longgar → berhenti sebelum memanggil docker', () => {
  for (const [env, re] of [[{ ...OK, DEPLOY_TAG: 'latest' }, /sha-<12 hex>/], [{ ...OK, DEPLOY_TAG: 'sha-1a2b3c4d5e6f; rm -rf /' }, /sha-<12 hex>/], [{ ...OK, DEPLOY_REPO: 'a/b c' }, /tidak sah/]] as const) {
    const r = run(sandbox(), env); assert.equal(r.code, 1); assert.match(r.out, re); assert.deepEqual(r.calls, [])
  }
  let r = run(sandbox({ env: false }), OK); assert.equal(r.code, 1); assert.match(r.out, /buat-env-production/); assert.deepEqual(r.calls, [])
  r = run(sandbox({ mode: 0o644 }), OK); assert.equal(r.code, 1); assert.match(r.out, /600/); assert.deepEqual(r.calls, [])
})
await t('deploy berjalan: login → pull versi baru → cadangan DB → up → reload Caddy → health → logout; versi lama disimpan', () => {
  const box = sandbox({ running: true })
  const r = run(box, OK)
  assert.equal(r.code, 0, r.out)
  const idx = (re: RegExp) => { const i = r.calls.findIndex(c => re.test(c)); assert.ok(i >= 0, `tak ada panggilan ${re}`); return i }
  const order = [/^login ghcr\.io -u bot --password-stdin/, /\.env\.deploy\.next pull --quiet/, /pg_dump -U saudinesia/, /up -d --remove-orphans/, /caddy reload/, /exec -T web bun -e/, /^logout ghcr\.io/]
  const pos = order.map(idx)
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, `urutan salah: ${r.calls.join(' | ')}`)
  assert.ok(!r.calls.some(c => c.includes('rahasia-token-uji')), 'token tak boleh muncul di argumen')
  assert.ok(!r.out.includes('rahasia-token-uji'))
  assert.match(readFileSync(join(box.dir, '.env.deploy'), 'utf8'), /^IMAGE_TAG=sha-1a2b3c4d5e6f$/m)
  assert.match(readFileSync(join(box.dir, '.env.deploy.prev'), 'utf8'), /^IMAGE_TAG=sha-000000000000$/m)
  const dumps = readdirSync(join(box.dir, 'backups'))
  assert.equal(dumps.length, 1); assert.match(dumps[0]!, /^pre-deploy-\d{8}T\d{6}Z-sha-1a2b3c4d5e6f\.dump$/)
})
await t('deploy pertama (belum ada DB): tanpa cadangan, tetap jalan', () => {
  const box = sandbox()
  const r = run(box, OK)
  assert.equal(r.code, 0, r.out)
  assert.ok(!r.calls.some(c => c.includes('pg_dump')))
  assert.ok(!existsSync(join(box.dir, '.env.deploy.prev')))
})
await t('pull gagal → versi berjalan TIDAK berubah, tak ada up', () => {
  const box = sandbox({ running: true, fail: 'pull' })
  const r = run(box, OK)
  assert.equal(r.code, 1)
  assert.ok(!r.calls.some(c => c.includes('up -d')))
  assert.match(readFileSync(join(box.dir, '.env.deploy'), 'utf8'), /IMAGE_TAG=sha-000000000000/)
})
await t('migrate/up gagal → log + petunjuk rollback ke tag sebelumnya, keluar 1', () => {
  const r = run(sandbox({ running: true, fail: 'up -d' }), OK)
  assert.equal(r.code, 1)
  assert.match(r.out, /DEPLOY GAGAL \(compose up \/ migrate\)/)
  assert.match(r.out, /image_tag = sha-000000000000/)
})
await t('health tak pernah sehat → gagal (dibatasi, tak menggantung)', () => {
  const r = run(sandbox({ running: true, fail: 'exec -T web' }), { ...OK, HEALTH_TRIES: '2' })
  assert.equal(r.code, 1)
  assert.match(r.out, /health check/)
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
