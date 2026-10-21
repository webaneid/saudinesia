import cron from 'node-cron'
import { prisma } from '@/lib/db'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Harian: hapus token auth yang sudah dipakai atau kedaluwarsa > 7 hari (minimalisasi data UU PDP — baris pendaftaran menyimpan
 * isian milik orang yang mungkin tak pernah jadi pengguna; sekaligus mencegah tabel tumbuh tanpa batas).
 */
export function startAuthTokenCleanupJob(): void {
  cron.schedule('30 3 * * *', async () => {
    try {
      const cutoff = new Date(Date.now() - 7 * DAY_MS)
      const r = await prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } })
      if (r.count > 0) console.log(`[cron] auth_tokens dibersihkan: ${r.count}`)
    } catch (e) {
      console.error('[cron] pembersihan auth_tokens gagal:', e instanceof Error ? e.name : e)
    }
  })
}
