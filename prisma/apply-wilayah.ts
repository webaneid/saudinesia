// Sekali jalan di image `migrate`, SESUDAH migrasi dan peran aplikasi (Dockerfile target migrate): isi/segarkan data wilayah Indonesia.
// Dulu hanya skrip manual yang tak ikut image — tabelnya kosong di produksi dan semua alamat Indonesia tertahan (docs/arsitektur-alamat.md §10).
// Idempoten: hanya baris baru/berbeda yang ditulis, tak pernah menghapus. Satu transaksi berkunci (advisory), lalu DIPERIKSA di DB —
// satu baris pun kurang = keluar 1 = deploy berhenti. Lewat `Bun.SQL` (pola apply-app-role.ts): klien Prisma tak di-generate di image migrate.
// Di mesin dev: `bun run db:wilayah`.
import { readFileSync } from 'node:fs'
import { parseWilayah, wilayahStatements } from './wilayah'

type BunSql = {
  begin<T>(fn: (tx: BunSql) => Promise<T>): Promise<T>
  unsafe<T = unknown>(query: string, values?: unknown[]): Promise<T[]>
  close(): Promise<void>
}
declare const Bun: { SQL: new (url: string) => BunSql }

const CHUNK = 5000
const url = process.env.DATABASE_URL ?? ''

async function main() {
  if (!url) throw new Error('DATABASE_URL kosong')
  const levels = parseWilayah(readFileSync(new URL('./data/wilayah.sql', import.meta.url), 'utf8'))
  const db = new Bun.SQL(url)
  try {
    await db.begin(async (tx) => {
      await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('apply-wilayah'))")
      for (const l of levels) {
        const q = wilayahStatements(l)
        let written = 0, missing = 0
        for (let i = 0; i < l.rows.length; i += CHUNK) {
          const json = JSON.stringify(l.rows.slice(i, i + CHUNK))
          written += (await tx.unsafe(q.upsert, [json])).length
          missing += (await tx.unsafe<{ n: number }>(q.missing, [json]))[0]?.n ?? CHUNK
        }
        if (missing > 0) throw new Error(`${l.table}: ${missing} baris tidak sesuai sesudah diisi`)
        console.log(`[wilayah] ${l.table}: ${l.rows.length} baris lengkap (${written} ditulis)`)
      }
    })
  } finally { await db.close() }
}

main().then(() => process.exit(0), (e: unknown) => {
  console.error(`[wilayah] GAGAL — alamat Indonesia tak bisa dipakai tanpa data ini: ${e instanceof Error ? e.message : 'galat'}`) // log-pii-ok: data referensi publik, tanpa sandi/URL
  process.exit(1)
})
