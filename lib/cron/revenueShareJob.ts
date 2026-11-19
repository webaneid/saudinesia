import cron from 'node-cron'
import { ensurePricesFollowRevenueShare } from '@/lib/revenue-share/pricing'
import { logError } from '@/lib/log'

/**
 * Setiap 10 menit: harga otomatis mengikuti aturan bagi hasil Platform Provider yang berlaku (docs/arsitektur-bagi-hasil.md, Fase 13b). Menangkap perubahan yang
 * tidak lewat aplikasi — akun Platform Provider dipasang/dicabut dengan scripts/set-platform-provider.ts. Pemeriksaan murah (dua kueri) bila tak ada perubahan.
 */
export function startRevenueSharePricingJob(): void {
  cron.schedule('*/10 * * * *', () => {
    ensurePricesFollowRevenueShare().catch(e => logError('cron harga bagi hasil gagal', e))
  })
}
