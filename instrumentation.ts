// Next.js instrumentation — runs once on server startup (not on hot reload)
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation

declare const globalThis: { _cronStarted?: boolean } & typeof global

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (globalThis._cronStarted) return
  globalThis._cronStarted = true

  const { startAutoCancelJob, startPaymentReminderJob } = await import('@/lib/cron/autocancelJob')
  startAutoCancelJob()
  startPaymentReminderJob()

  const { startExchangeRateJob } = await import('@/lib/cron/exchangeRateJob')
  startExchangeRateJob()

  void ensureMinioBucket()
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
