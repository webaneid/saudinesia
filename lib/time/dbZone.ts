// Pemeriksaan zona sesi database saat boot (docs/arsitektur-booking-engine-v2.md §5.5). Khusus server (memakai Prisma) — SENGAJA terpisah dari `lib/time/index.ts` yang murni dan dipakai klien.
import { prisma } from '@/lib/db'

const UTC_NAMES = new Set(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'Zulu'])

export type DbZoneCheck = { ok: boolean; zone: string }

/** Zona sesi database harus UTC (migrasi `database_timezone_utc` memaksanya). Tidak melempar. */
export async function checkDatabaseTimezone(client: { $queryRaw: typeof prisma.$queryRaw } = prisma): Promise<DbZoneCheck> {
  try {
    // $queryRaw: Prisma ORM tidak bisa membaca parameter sesi.
    const rows = await client.$queryRaw<{ TimeZone: string }[]>`SHOW timezone`
    const zone = rows[0]?.TimeZone ?? '(tak diketahui)'
    const ok = UTC_NAMES.has(zone)
    if (!ok) console.error(`[waktu] Zona sesi database = "${zone}", bukan UTC. SQL mentah dengan now()/CURRENT_TIMESTAMP pada kolom tanpa zona akan menyimpan waktu yang salah. Jalankan migrasi (prisma migrate deploy) atau set timezone UTC pada database.`)
    return { ok, zone }
  } catch (e) {
    console.error('[waktu] Gagal memeriksa zona database:', e instanceof Error ? e.message : String(e))
    return { ok: false, zone: '(gagal)' }
  }
}
