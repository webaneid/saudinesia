import cron from 'node-cron'
import { sweepRecentErasures } from '@/lib/account/erasureSweep'
import { logError } from '@/lib/log'

/**
 * Harian: sapu ulang akun yang dianonimkan dalam 7 hari terakhir (tulis terlambat: unggahan dokumen / notify yang sedang terbang saat
 * commit penghapusan — SEC-57). Idempoten; tidak menyentuh akun yang belum dianonimkan.
 */
export function startErasureSweepJob(): void {
  cron.schedule('10 4 * * *', async () => {
    try {
      const r = await sweepRecentErasures(7)
      if (r.objects + r.notificationLogs + r.failed > 0) console.log(`[cron] penyapuan akun terhapus: akun=${r.accounts} objek=${r.objects} log=${r.notificationLogs} gagal=${r.failed}`)
    } catch (e) {
      logError('cron penyapuan akun terhapus gagal', e)
    }
  })
}
