// Sekali jalan di image `migrate`, SESUDAH `prisma migrate deploy` (Dockerfile target migrate): buat/perbarui peran aplikasi
// `saudinesia_app` (DML saja) atas koneksi pemilik skema (`DATABASE_URL` kontainer migrate). Lihat prisma/appRole.ts dan docs/deployment.md
// "Peran database".
//
// Lewat klien Postgres bawaan Bun (`Bun.SQL`), BUKAN `bunx prisma db execute --stdin`: CLI itu melapor "Script executed successfully" tanpa
// menjalankan apa pun (runner CI Linux 2026-11-19, lalu image migrate 2026-11-21 — peran tak pernah terbentuk dan web gagal login ke DB).
// Sesudah diterapkan, peran DIPERIKSA di katalog — skrip gagal bila peran tak ada atau berhak lebih (fail-closed, tak lagi percaya laporan alat).
import { APP_ROLE, appRoleStatements } from './appRole'

// Tipe global `Bun` tidak ada di project (tanpa @types/bun) — deklarasi minimal lokal modul (pola scripts/create-superadmin.ts).
type BunSql = {
  begin<T>(fn: (tx: BunSql) => Promise<T>): Promise<T>
  unsafe(query: string): Promise<unknown[]>
  close(): Promise<void>
} & (<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>)
declare const Bun: { SQL: new (url: string) => BunSql }

const url = process.env.DATABASE_URL ?? ''
let statements: string[]
try {
  if (!url) throw new Error('DATABASE_URL (pemilik skema) kosong')
  statements = appRoleStatements(APP_ROLE, process.env.APP_DB_PASSWORD ?? '')
} catch (e) {
  console.error(`[app-role] ${e instanceof Error ? e.message : 'gagal'}`) // log-pii-ok: pesan validasi buatan sendiri, tanpa nilai sandi/URL
  process.exit(1)
}

const db = new Bun.SQL(url)
try {
  await db.begin(async (tx) => { for (const q of statements) await tx.unsafe(q) })
  const rows = await db<{ super: boolean; login: boolean; owns: number }>`
    SELECT r.rolsuper AS super, r.rolcanlogin AS login,
           (SELECT count(*)::int FROM pg_class c WHERE c.relowner = r.oid) AS owns
    FROM pg_roles r WHERE r.rolname = ${APP_ROLE}`
  const role = rows[0]
  if (!role) throw new Error('peran tidak terbentuk')
  if (role.super || !role.login || role.owns > 0) throw new Error('peran berhak lebih dari DML (superuser/pemilik) atau tak bisa login')
  console.log(`[app-role] peran ${APP_ROLE} siap (DML saja, diperiksa di katalog)`)
} catch (e) {
  // Pesan galat Postgres tak memuat sandi (ALTER ROLE gagal hanya menyebut sintaks/izin); tetap disingkat ke pesannya saja.
  console.error(`[app-role] gagal menerapkan peran aplikasi: ${e instanceof Error ? e.message : 'galat'}`) // log-pii-ok: tanpa sandi/PII
  await db.close()
  process.exit(1)
}
await db.close()
