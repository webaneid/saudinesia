import { prisma } from '@/lib/db'
import { refreshAllPricingCaches } from '@/lib/pricing/refreshAll'
import { effectiveRevenueShare, revenueShareRuleKey } from './settings'

// Harga otomatis mengikuti aturan bagi hasil (Fase 13b, keputusan Q4): bila aturan berlaku (persen/dasar, atau ada/tidaknya akun Platform Provider aktif) berbeda dengan
// yang terakhir diterapkan, SEMUA harga dihitung ulang lewat satu pintu `refreshAllPricingCaches`. Harga manual tidak berubah; booking terbit tidak berubah (beku).
// Satu-satunya penulis `revenue_share_pricing_state`. Dipanggil saat boot, cron 10 menit, dan sesudah setelan disimpan.

const STATE_ID = 'global'
let running: Promise<boolean> | null = null
let again = false

async function appliedKey(): Promise<string | null> {
  return (await prisma.revenueSharePricingState.findUnique({ where: { id: STATE_ID }, select: { ruleKey: true } }))?.ruleKey ?? null
}

async function run(): Promise<boolean> {
  let changed = false
  // Diulang bila aturan berubah lagi selama hitung ulang berjalan — yang tercatat selalu aturan yang benar-benar dipakai putaran terakhir.
  for (let i = 0; i < 3; i++) {
    const rule = await effectiveRevenueShare()
    const key = revenueShareRuleKey(rule)
    if (key === (await appliedKey())) return changed
    const failed = await refreshAllPricingCaches()
    changed = true
    // Kegagalan sebagian TIDAK membuat putaran diulang tiap 10 menit (SEC-280): pemilik yang gagal mempertahankan harga terakhirnya dan dicoba lagi oleh pemicu
    // harga biasa (kurs, margin, ubah biaya) — sama dengan kegagalan hitung ulang lainnya; yang tercatat = aturan yang dipakai putaran ini.
    if (failed.length > 0) console.error(`[revenue-share] hitung ulang harga gagal untuk: ${failed.join(', ')} — harga pemilik itu tetap yang terakhir`)
    if (key !== revenueShareRuleKey(await effectiveRevenueShare())) continue
    const data = { ruleKey: key, percent: rule?.percent ?? null, basis: rule?.basis ?? null, settingId: rule?.settingId ?? null, appliedAt: new Date() }
    await prisma.revenueSharePricingState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID, ...data }, update: data })
    return changed
  }
  return changed
}

/** Mengembalikan true bila harga dihitung ulang. Satu proses (satu replika): pemanggil di tengah putaran menjadwalkan satu putaran lagi (setelan yang baru disimpan tak terlewat). */
export function ensurePricesFollowRevenueShare(): Promise<boolean> {
  if (running) { again = true; return running }
  running = (async () => {
    let changed = false
    do { again = false; changed = (await run()) || changed } while (again)
    return changed
  })().finally(() => { running = null })
  return running
}
