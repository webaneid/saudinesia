import type { PrismaClient } from '@prisma/client'

// Penjaga `prisma/seed.ts` (SEC-27, docs/lessons-learned.md). Seed MENGHAPUS data katalog/harga dan membuat akun demo ber-password
// default yang diketahui publik (`Admin@1234`) — hanya boleh jalan di mesin pengembangan dengan database lokal.
// Fail-closed: semua syarat harus terpenuhi; ketiadaan/kesalahan penulisan = ditolak.
//
// Mengapa dijaga di dalam seed, bukan hanya dokumentasi: image `migrate` menyalin folder `prisma/` dan membawa DATABASE_URL produksi,
// jadi `prisma db seed` dari sana akan mengenai DB produksi. NODE_ENV di image itu tidak 'development', dan host-nya bukan lokal.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export type SeedEnv = { nodeEnv?: string; databaseUrl?: string; allowHost?: string; superadminPassword?: string }

function parseDb(url: string | undefined): URL | null {
  try { return new URL(url ?? '') } catch { return null }
}

/** Host benar-benar loopback (bukan sekadar diizinkan lewat SEED_ALLOW_HOST). */
export function isLoopbackDb(databaseUrl: string | undefined): boolean {
  const u = parseDb(databaseUrl)
  return !!u && LOCAL_HOSTS.has(u.hostname)
}

/** Alasan seed ditolak berdasarkan lingkungan; `null` bila boleh lanjut. Murni (tanpa I/O) supaya bisa diuji. */
export function seedEnvProblem(env: SeedEnv): string | null {
  if (env.nodeEnv !== 'development') {
    return `NODE_ENV harus persis "development" (sekarang ${JSON.stringify(env.nodeEnv ?? null)}). Jalankan lewat \`bun run db:seed\`, yang menetapkannya.`
  }
  const u = parseDb(env.databaseUrl)
  if (!u) return 'DATABASE_URL kosong atau tidak bisa diparse.'
  // Parameter query `host`/`hostaddr` MENIMPA host koneksi Postgres di Prisma (diverifikasi: `postgresql://u:p@localhost/x?host=db.invalid` tersambung
  // ke db.invalid) — pemeriksaan `hostname` saja bisa dilewati. Host yang diperiksa harus host yang benar-benar tersambung (S26-T03).
  for (const key of u.searchParams.keys()) {
    if (['host', 'hostaddr'].includes(key.toLowerCase())) return `DATABASE_URL memakai parameter "${key}" yang menimpa host koneksi — tidak diizinkan untuk seed.`
  }
  const host = u.hostname
  const allowed = env.allowHost ? host === env.allowHost : false // allowHost kosong = tidak diset (S26-T05)
  if (!LOCAL_HOSTS.has(host) && !allowed) {
    return `host database "${host}" bukan mesin lokal. Seed menghapus data katalog dan hanya boleh menyentuh database pengembangan lokal (SEED_ALLOW_HOST=<host> hanya bila memang disengaja).`
  }
  // Host non-loopback (hanya lewat SEED_ALLOW_HOST): jangan pernah memakai password default yang tertulis di repo (S26-T06).
  if (!LOCAL_HOSTS.has(host) && !env.superadminPassword) {
    return 'host non-lokal wajib SUPERADMIN_PASSWORD eksplisit — seed tidak akan memasang password default "Admin@1234" di database yang bisa dijangkau jaringan.'
  }
  return null
}

/** Nama sasaran untuk dicetak sebelum menghapus (tanpa kredensial). */
export function seedTarget(databaseUrl: string | undefined): string {
  const u = parseDb(databaseUrl)
  return u ? `host=${u.hostname} db=${u.pathname.replace(/^\//, '')}` : '(tidak diketahui)'
}

/** Database yang sudah berisi data nyata (jamaah/booking/akun non-demo) tidak boleh di-seed tanpa SEED_FORCE=1. */
export async function seedDataProblem(prisma: Pick<PrismaClient, 'user' | 'booking'>, force: boolean): Promise<string | null> {
  if (force) return null
  const [pilgrims, bookings, realUsers] = await Promise.all([
    prisma.user.count({ where: { role: 'pilgrim' } }),
    prisma.booking.count(),
    // Akun yang BUKAN akun demo seed (`*.local`): superadmin produksi dibuat lewat create-superadmin.ts dengan email nyata, jadi ini
    // menutup jendela sebelum go-live (belum ada jamaah/booking, tapi katalog & harga sudah diisi manajer) — S26-T04.
    prisma.user.count({ where: { NOT: { email: { endsWith: '.local' } } } }),
  ])
  if (pilgrims > 0 || bookings > 0 || realUsers > 0) {
    return `database berisi ${pilgrims} jamaah, ${bookings} booking dan ${realUsers} akun non-demo — seed menghapus data katalog/harga dan menimpa akun demo. Set SEED_FORCE=1 hanya bila itu memang database buangan.`
  }
  return null
}
