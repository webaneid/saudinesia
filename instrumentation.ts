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
}
