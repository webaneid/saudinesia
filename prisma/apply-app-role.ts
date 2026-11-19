// Sekali jalan di image `migrate`, SESUDAH `prisma migrate deploy` (Dockerfile target migrate): buat/perbarui peran aplikasi
// `saudinesia_app` (DML saja) atas koneksi pemilik skema (`DATABASE_URL` kontainer migrate). SQL dikirim lewat stdin — sandi tak muncul di
// argumen proses. Lihat prisma/appRole.ts dan docs/deployment.md "Peran database".
import { spawnSync } from 'node:child_process'
import { APP_ROLE, appRoleSql } from './appRole'

const password = process.env.APP_DB_PASSWORD ?? ''
let sql: string
try {
  sql = appRoleSql(APP_ROLE, password)
} catch (e) {
  console.error(`[app-role] ${e instanceof Error ? e.message : 'gagal'}`) // log-pii-ok: pesan validasi buatan sendiri, tanpa nilai sandi
  process.exit(1)
}

const res = spawnSync('bunx', ['prisma', 'db', 'execute', '--stdin', '--schema', 'prisma/schema.prisma'], { input: sql, stdio: ['pipe', 'inherit', 'inherit'] })
if (res.status !== 0) { console.error('[app-role] gagal menerapkan peran aplikasi'); process.exit(res.status ?? 1) }
console.log(`[app-role] peran ${APP_ROLE} siap (DML saja)`)
