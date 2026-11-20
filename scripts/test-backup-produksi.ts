// Penjaga skrip backup produksi (scripts/backup-produksi.sh, setup-backup.sh, uji-restore.sh). Tanpa Docker/Drive sungguhan: skrip
// dijalankan dengan `docker`/`curl`/`flock` TIRUAN di PATH yang mencatat argumen (dan rahasia yang diteruskan lewat environment), jadi
// URUTAN langkah, retensi, dan bahwa rahasia tak pernah tampil di argumen proses terbukti. Bagian pg_dump/pg_restore yang sungguhan
// dibuktikan terpisah saat uji pulih di server (docs/deployment.md "Backup").
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${String((e as Error).message).split('\n').slice(0, 10).join('\n     ')}`) }
}

const SECRETS = { minioKey: 'kunciminio-rahasia', minioSecret: 'sandiminio-rahasia', crypt1: 'OBS-crypt-satu', crypt2: 'OBS-crypt-dua' }
const HIST_OLD = '20200101T020000Z'
const HIST_NEW = '29990101T020000Z'

function sandbox(opts: { backupEnv?: boolean; rcloneConf?: string | false; fail?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'backup-'))
  const home = join(dir, 'home'); const bin = join(dir, 'bin'); const backups = join(dir, 'backups')
  mkdirSync(bin, { recursive: true }); mkdirSync(join(home, '.config/rclone'), { recursive: true })
  const log = join(dir, 'docker.log'); const envlog = join(dir, 'env.log'); const curllog = join(dir, 'curl.log')
  writeFileSync(join(bin, 'docker'), `#!/usr/bin/env bash
echo "$*" >> "${log}"
echo "crypt=\${RCLONE_CONFIG_CRYPT_PASSWORD:-}|\${RCLONE_CONFIG_CRYPT_PASSWORD2:-} minio=\${RCLONE_CONFIG_MINIO_ACCESS_KEY_ID:-}|\${RCLONE_CONFIG_MINIO_SECRET_ACCESS_KEY:-}" >> "${envlog}"
${opts.fail ? `[[ "$*" == *"${opts.fail}"* ]] && exit 1` : ''}
case "$*" in
  *"pg_dump"*) echo DUMPDATA ;;
  *"pg_restore --list"*) cat > /dev/null ;;
  *"pg_restore -U"*) cat > /dev/null ;;
  *"psql"*) echo 95 ;;
  *"obscure -"*) read -r pw; echo "OBS-\${pw:0:8}" ;;
  *" cat crypt:"*) echo ok ;;
  *" rcat crypt:"*) cat > /dev/null ;;
  *"lsf --dirs-only crypt:minio/history/"*) printf '${HIST_OLD}/\\n${HIST_NEW}/\\nbukan-tanggal/\\n' ;;
  *"lsf --files-only"*) printf 'db-20261120T020000Z.dump\\ndb-20261121T020000Z.dump\\n' ;;
  *"copy crypt:db/"*) mkdir -p "${backups}/uji-restore" && echo DUMPDATA > "${backups}/uji-restore/db-20261121T020000Z.dump" ;;
esac
exit 0
`)
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash\necho "$*" >> "${curllog}"\nexit 0\n`)
  writeFileSync(join(bin, 'flock'), '#!/usr/bin/env bash\nexit 0\n')
  for (const f of ['docker', 'curl', 'flock']) chmodSync(join(bin, f), 0o755)
  writeFileSync(join(dir, '.env.production'), `MINIO_ACCESS_KEY=${SECRETS.minioKey}\nMINIO_SECRET_KEY=${SECRETS.minioSecret}\nRESEND_FROM=Saudinesia <no-reply@saudinesia.id>\n`)
  chmodSync(join(dir, '.env.production'), 0o600)
  writeFileSync(join(dir, '.env.deploy'), 'GITHUB_REPO=webaneid/saudinesia\nIMAGE_TAG=sha-000000000000\n')
  if (opts.backupEnv !== false) {
    writeFileSync(join(dir, '.env.backup'), `BACKUP_CRYPT_PASSWORD=${SECRETS.crypt1}\nBACKUP_CRYPT_PASSWORD2=${SECRETS.crypt2}\nBACKUP_PING_URL=https://hc-ping.com/uji\n`)
    chmodSync(join(dir, '.env.backup'), 0o600)
  }
  if (opts.rcloneConf !== false) writeFileSync(join(home, '.config/rclone/rclone.conf'), opts.rcloneConf ?? '[gdrive]\ntype = drive\nscope = drive\n')
  return { dir, home, bin, backups, log, envlog, curllog }
}
type Box = ReturnType<typeof sandbox>
function run(box: Box, script: string, env: Record<string, string> = {}) {
  const r = spawnSync('bash', [resolve(script)], {
    env: { PATH: `${box.bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: box.home, APP_DIR: box.dir, ...env } as unknown as NodeJS.ProcessEnv,
    encoding: 'utf8',
  })
  const lines = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [])
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: lines(box.log), envs: lines(box.envlog), curls: lines(box.curllog) }
}
const noSecretInArgs = (calls: string[], out: string) => {
  for (const s of Object.values(SECRETS)) {
    assert.ok(!calls.some(c => c.includes(s)), `rahasia "${s}" muncul di argumen docker`)
    assert.ok(!out.includes(s), `rahasia "${s}" tercetak`)
  }
}

console.log('== backup-produksi.sh ==')
await t('urutan: dump → verifikasi → unggah db → sinkron MinIO (riwayat) → retensi; ping start/sukses; tercatat last-success', () => {
  const box = sandbox()
  mkdirSync(join(box.backups, 'daily'), { recursive: true })
  for (let i = 0; i < 9; i++) writeFileSync(join(box.backups, 'daily', `db-2026010${i}T020000Z.dump`), 'x')
  const r = run(box, 'scripts/backup-produksi.sh')
  assert.equal(r.code, 0, r.out)
  const idx = (re: RegExp) => { const i = r.calls.findIndex(c => re.test(c)); assert.ok(i >= 0, `tak ada panggilan ${re}\n${r.calls.join('\n')}`); return i }
  const order = [/exec -T postgres pg_dump -U saudinesia -d saudinesia --format=custom/, /exec -T postgres pg_restore --list/,
    /rclone\/rclone:1\.75\.1@sha256:[0-9a-f]{64} copy \/backup\/daily\/db-\d{8}T\d{6}Z\.dump crypt:db\/$/,
    /sync minio:saudinesia-docs crypt:minio\/current --backup-dir crypt:minio\/history\/\d{8}T\d{6}Z$/,
    /delete --min-age 30d crypt:db\/$/, /lsf --dirs-only crypt:minio\/history\//]
  const pos = order.map(idx)
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'urutan salah')
  // Retensi riwayat: hanya folder bertanggal lama; folder baru & nama asing tak disentuh.
  const purges = r.calls.filter(c => c.includes(' purge '))
  assert.deepEqual(purges.map(c => c.split(' ').pop()), [`crypt:minio/history/${HIST_OLD}`])
  // Kontainer rclone: jaringan internal compose, crypt di atas folder Drive pola backup-app/<project>.
  const rc = r.calls.find(c => c.includes(' sync '))!
  assert.match(rc, /--network [^ ]+_internal /) // nama folder APP_DIR + _internal (produksi: app_internal)
  assert.match(rc, /RCLONE_CONFIG_CRYPT_REMOTE=gdrive:backup-app\/saudinesia /)
  // Rahasia diteruskan lewat environment (-e NAMA tanpa nilai) — sampai ke kontainer, tak pernah di argumen.
  assert.match(rc, /-e RCLONE_CONFIG_CRYPT_PASSWORD -e RCLONE_CONFIG_CRYPT_PASSWORD2 /)
  assert.ok(r.envs.some(e => e === `crypt=${SECRETS.crypt1}|${SECRETS.crypt2} minio=${SECRETS.minioKey}|${SECRETS.minioSecret}`), r.envs.join('\n'))
  noSecretInArgs(r.calls, r.out)
  assert.deepEqual(r.curls.map(c => c.split(' ').pop()), ['https://hc-ping.com/uji/start', 'https://hc-ping.com/uji'])
  assert.match(readFileSync(join(box.backups, 'last-success'), 'utf8'), /^\d{8}T\d{6}Z db-\d{8}T\d{6}Z\.dump\n$/)
  // 9 lama + 1 baru → tersisa 7 terbaru; folder & berkas hanya untuk pemilik.
  assert.equal(readdirSync(join(box.backups, 'daily')).length, 7)
  assert.equal(statSync(box.backups).mode & 0o777, 0o700)
})
await t('tanpa .env.backup / rclone.conf → gagal sebelum dump, ping /fail', () => {
  for (const box of [sandbox({ backupEnv: false }), sandbox({ rcloneConf: false })]) {
    const r = run(box, 'scripts/backup-produksi.sh')
    assert.equal(r.code, 1, r.out)
    assert.ok(!r.calls.some(c => c.includes('pg_dump')))
    assert.match(r.out, /BACKUP GAGAL pada langkah: konfigurasi/)
  }
  const r = run(sandbox({ backupEnv: false }), 'scripts/backup-produksi.sh')
  assert.deepEqual(r.curls, []) // tanpa .env.backup tak ada URL ping — gagal tercatat di log
})
for (const [step, pat] of [['dump database', 'pg_dump'], ['verifikasi dump', 'pg_restore --list'], ['unggah database', 'copy /backup'], ['sinkron MinIO', ' sync ']] as const) {
  await t(`gagal pada "${step}" → keluar 1, langkah disebut, ping /fail, last-success tak ditulis`, () => {
    const box = sandbox({ fail: pat })
    const r = run(box, 'scripts/backup-produksi.sh')
    assert.equal(r.code, 1, r.out)
    assert.match(r.out, new RegExp(`BACKUP GAGAL pada langkah: ${step}`))
    assert.ok(r.curls.some(c => c.endsWith('/fail')))
    assert.ok(!existsSync(join(box.backups, 'last-success')))
    noSecretInArgs(r.calls, r.out)
  })
}
await t('masukan env tak sah ditolak sebelum docker', () => {
  for (const env of [{ BACKUP_KEEP_DAYS: '0' }, { BACKUP_LOCAL_KEEP: '3; rm -rf /' }, { DRIVE_PATH: 'gdrive:a b' }] as Record<string, string>[]) {
    const r = run(sandbox(), 'scripts/backup-produksi.sh', env)
    assert.equal(r.code, 1); assert.deepEqual(r.calls, [])
  }
})

console.log('== setup-backup.sh ==')
await t('membuat .env.backup (600, tersamar) — bukan .env.production; kata sandi asli dicetak sekali, tak di argumen; uji Drive', () => {
  const box = sandbox({ backupEnv: false })
  const before = readFileSync(join(box.dir, '.env.production'), 'utf8')
  const r = run(box, 'scripts/setup-backup.sh')
  assert.equal(r.code, 0, r.out)
  assert.equal(readFileSync(join(box.dir, '.env.production'), 'utf8'), before, '.env.production tak boleh berubah')
  const env = readFileSync(join(box.dir, '.env.backup'), 'utf8')
  assert.equal(statSync(join(box.dir, '.env.backup')).mode & 0o777, 0o600)
  const pw = [...r.out.matchAll(/password2? += ([0-9a-f]{64})/g)].map(m => m[1]!)
  assert.equal(pw.length, 2, r.out)
  assert.notEqual(pw[0], pw[1])
  assert.match(env, new RegExp(`^BACKUP_CRYPT_PASSWORD=OBS-${pw[0]!.slice(0, 8)}$`, 'm'))
  assert.match(env, new RegExp(`^BACKUP_CRYPT_PASSWORD2=OBS-${pw[1]!.slice(0, 8)}$`, 'm'))
  assert.match(env, /^BACKUP_PING_URL=$/m)
  for (const p of pw) assert.ok(!r.calls.some(c => c.includes(p)), 'kata sandi asli di argumen docker')
  assert.ok(r.calls.some(c => / rcat crypt:uji-koneksi-/.test(c)) && r.calls.some(c => / deletefile crypt:uji-koneksi-/.test(c)))
  assert.equal(statSync(join(box.home, '.config/rclone/rclone.conf')).mode & 0o777, 0o600)
})
await t('dijalankan ulang → kata sandi TIDAK ditimpa dan tidak dicetak', () => {
  const box = sandbox()
  const before = readFileSync(join(box.dir, '.env.backup'), 'utf8')
  const r = run(box, 'scripts/setup-backup.sh')
  assert.equal(r.code, 0, r.out)
  assert.equal(readFileSync(join(box.dir, '.env.backup'), 'utf8'), before)
  assert.doesNotMatch(r.out, /password +=/)
  assert.ok(!r.calls.some(c => c.includes('obscure')))
})
await t('tanpa rclone.conf / tanpa remote [gdrive] / izin .env.backup longgar → berhenti sebelum docker', () => {
  let r = run(sandbox({ backupEnv: false, rcloneConf: false }), 'scripts/setup-backup.sh'); assert.equal(r.code, 1); assert.match(r.out, /scp/); assert.deepEqual(r.calls, [])
  r = run(sandbox({ backupEnv: false, rcloneConf: '[lain]\ntype = drive\n' }), 'scripts/setup-backup.sh'); assert.equal(r.code, 1); assert.match(r.out, /\[gdrive\]/); assert.deepEqual(r.calls, [])
  const box = sandbox(); chmodSync(join(box.dir, '.env.backup'), 0o644)
  r = run(box, 'scripts/setup-backup.sh'); assert.equal(r.code, 1); assert.match(r.out, /600/); assert.deepEqual(r.calls, [])
})

console.log('== uji-restore.sh ==')
await t('dump TERBARU dari Drive → DB sementara → bandingkan → cryptcheck MinIO → DB sementara dihapus; produksi tak ditulis', () => {
  const box = sandbox()
  const r = run(box, 'scripts/uji-restore.sh')
  assert.equal(r.code, 0, r.out)
  assert.ok(r.calls.some(c => c.endsWith('copy crypt:db/db-20261121T020000Z.dump /backup/uji-restore/')), 'harus dump terbaru')
  assert.ok(r.calls.some(c => /pg_restore -U saudinesia -d saudinesia_uji_restore --no-owner --exit-on-error$/.test(c)))
  assert.ok(r.calls.some(c => c.endsWith('cryptcheck minio:saudinesia-docs crypt:minio/current --one-way')))
  // Satu-satunya tulisan ke database = DB sementara; tak ada pg_restore/DROP ke `saudinesia`.
  assert.ok(!r.calls.some(c => /pg_restore .*-d saudinesia( |$)/.test(c)))
  assert.ok(!r.calls.some(c => /DROP DATABASE (IF EXISTS )?saudinesia( |$)/.test(c)))
  assert.match(r.calls.filter(c => c.includes('DROP DATABASE')).pop() ?? '', /DROP DATABASE IF EXISTS saudinesia_uji_restore$/)
  assert.ok(!existsSync(join(box.backups, 'uji-restore')), 'unduhan harus dibersihkan')
  noSecretInArgs(r.calls, r.out)
  assert.match(r.out, /OK: backup bisa dipulihkan/)
})
await t('pulih gagal → keluar 1, DB sementara tetap dihapus', () => {
  const r = run(sandbox({ fail: 'pg_restore -U' }), 'scripts/uji-restore.sh')
  assert.equal(r.code, 1)
  assert.match(r.calls.at(-1) ?? '', /DROP DATABASE IF EXISTS saudinesia_uji_restore/)
})

console.log('== deploy.yml ==')
await t('ketiga skrip ikut disalin tiap deploy; skrip lama tak ada lagi', () => {
  const src = readFileSync('.github/workflows/deploy.yml', 'utf8')
  for (const f of ['scripts/backup-produksi.sh', 'scripts/setup-backup.sh', 'scripts/uji-restore.sh']) assert.ok(src.includes(f), f)
  for (const f of ['backup-db.sh', 'backup-minio.sh', 'restore-db.sh', 'restore-minio.sh']) assert.ok(!existsSync(`scripts/${f}`), f)
  assert.match(readFileSync('.gitignore', 'utf8'), /^\.env\.backup$/m)
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
