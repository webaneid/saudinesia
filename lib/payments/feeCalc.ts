// Biaya layanan gateway (D15, Fase 9 K9-2) — MURNI (aman di klien untuk pratinjau; server menghitung ulang dengan aturan dari DB).
export type FeeRule = { channelGroup: string; percent: number; flatIdr: number }

/** Biaya untuk nominal tagihan `amount` (rupiah bulat): persen dibulatkan KE ATAS ke rupiah + tetap. Kelompok tanpa aturan aktif = 0. */
export function gatewayFee(amount: number, group: string, rules: readonly FeeRule[]): number {
  const r = rules.find(x => x.channelGroup === group)
  if (!r) return 0
  return Math.ceil((Math.round(amount) * Math.round(r.percent * 100)) / 10_000) + r.flatIdr
}
