// Bagian Node dari instrumentation (dipanggil instrumentation.ts hanya di runtime nodejs).

declare const globalThis: { _cronStarted?: boolean } & typeof global

export async function registerNode() {
  if (globalThis._cronStarted) return
  globalThis._cronStarted = true

  const { startAutoCancelJob, startPaymentReminderJob } = await import('@/lib/cron/autocancelJob')
  startAutoCancelJob()
  startPaymentReminderJob()

  const { startAuthTokenCleanupJob } = await import('@/lib/cron/authTokenJob')
  startAuthTokenCleanupJob()

  const { startErasureSweepJob } = await import('@/lib/cron/erasureSweepJob')
  startErasureSweepJob()

  const { startExchangeRateJob } = await import('@/lib/cron/exchangeRateJob')
  startExchangeRateJob()

  void ensureMinioBucket()
  void repriceOnBoot()
  void import('@/lib/invoice/settings').then(m => m.loadAppTimezone()) // zona aplikasi dari Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6)
  void import('@/lib/time/dbZone').then(m => m.checkDatabaseTimezone()) // hanya memperingatkan: zona sesi DB harus UTC (docs/arsitektur-booking-engine-v2.md §5)
}

// Titik harga (`price_points`) dilengkapi/diperbarui saat server naik: migrasi hanya menyalin harga jual dari kolom lama (modal kosong); ini mengisi modal dan
// memperbaiki cache basi (docs/arsitektur-harga-terpadu.md §15). Idempoten, fire-and-forget — kegagalan hanya dicatat dan TIDAK menjatuhkan boot.
async function repriceOnBoot() {
  try {
    const { repriceAll } = await import('@/lib/pricing/engine')
    const failed = await repriceAll()
    if (failed.length > 0) console.error('[pricing] hitung ulang saat boot gagal untuk:', failed.join(', '))
  } catch (e) {
    console.error('[pricing] hitung ulang saat boot gagal:', e instanceof Error ? e.message : e)
  }
}

// Bucket dibuat otomatis bila belum ada (idempotent) — tanpa ini deploy pertama gagal saat unggah pertama
// karena tidak ada langkah manual `mc mb` di production. Fire-and-forget + retry: MinIO boleh belum siap saat web
// start; kegagalan hanya dicatat, TIDAK menjatuhkan boot (halaman non-storage tetap harus jalan).
async function ensureMinioBucket() {
  const { ensureBucketExists } = await import('@/lib/storage/minio')
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await ensureBucketExists()
      return
    } catch (e) {
      if (attempt === 5) {
        console.error('[minio] Gagal memastikan bucket setelah 5 percobaan:', e instanceof Error ? e.message : e)
        return
      }
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}
