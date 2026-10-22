import { prisma } from '@/lib/db'

// PENGAMAN skrip uji yang MENULIS ke database. Dua lapis, karena satu lapis pernah tertipu (2026-10-22):
//  1. URL diparse sungguhan dan path-nya harus TEPAT satu segmen. Dulu nama diambil dari segmen terakhir (`split('/').pop()`), jadi URL
//     ".../saudinesia/saudinesia_tmp_x" (hasil `sed` yang gagal) lolos padahal Postgres menyambung ke database "saudinesia" — DB dev.
//  2. Yang diperiksa akhirnya adalah database yang BENAR-BENAR tersambung (`select current_database()`), bukan teks URL.
// Berjangkar pada TOKEN nama (bukan substring): "latest"/"contest" tidak boleh lolos sebagai "test". Host juga dibatasi ke mesin lokal —
// database jarak jauh (staging/produksi) tidak pernah boleh jadi target skrip uji; opt-in eksplisit lewat TEST_DB_ALLOW_HOST bila memang perlu.
const SAFE = /(^|[_-])(test|ci|tmp)([_-]|$)/i
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function refuse(why: string): never {
  console.error(`DITOLAK: ${why} Skrip ini menulis data — hanya jalan di database sekali pakai (host lokal; nama memuat token test / ci / tmp).`)
  process.exit(2)
}

export async function assertThrowawayDb(): Promise<void> {
  const raw = process.env.DATABASE_URL ?? ''
  let name = ''
  try {
    const parsed = new URL(raw)
    const extra = process.env.TEST_DB_ALLOW_HOST
    if (!LOCAL_HOSTS.has(parsed.hostname) && parsed.hostname !== extra) refuse(`host "${parsed.hostname}" bukan mesin lokal.`)
    const segments = parsed.pathname.split('/').filter(Boolean)
    if (segments.length !== 1) refuse(`path URL database tidak lazim (${segments.length} segmen).`)
    name = decodeURIComponent(segments[0] ?? '')
  } catch {
    refuse('DATABASE_URL tidak bisa diparse.')
  }
  if (!SAFE.test(name)) refuse(`database "${name}" bukan database uji.`)

  const rows = await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`
  const actual = rows[0]?.db ?? ''
  if (!SAFE.test(actual)) refuse(`yang tersambung adalah database "${actual}", bukan "${name}".`)
}
