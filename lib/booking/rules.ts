import { parseRequiredComponents, type RequiredComponent } from '@/lib/validators/visa'

// Aturan booking (docs/arsitektur-booking-engine-v2.md D5, §4.1, §10.2). SATU tempat evaluasi — dipakai POST /bookings sekarang, form admin (Fase 5), dan front-end (Fase 11).
// Fungsi di sini MURNI: pemanggil mengumpulkan komponen booking (item + isi paket) lebih dulu, lalu meneruskannya ke sini.

/** Komponen yang ADA di booking: dari item mandiri dan dari isi Paket Umroh (`included`, atau `user_choice` yang sudah dipilih). */
export type BookingCoverage = {
  flight: boolean
  hotel: boolean
  transports: Array<{ tripId: string; category: string }>
}

export type VisaRuleSubject = { visaProductId: string; visaName: string; requiredComponents: unknown }

export type RuleViolation = {
  visaProductId: string
  visaName: string
  missing: RequiredComponent['type'] | 'rule'
  /** `error` menolak booking; `warning` = dilonggarkan untuk pelanggan ini (`User.allowVisaWithoutBundle`). */
  severity: 'error' | 'warning'
  message: string
}

const NAMES: Record<RequiredComponent['type'], string> = { flight: 'tiket pesawat', hotel: 'hotel', transport: 'transport' }

function satisfied(c: RequiredComponent, cov: BookingCoverage): boolean {
  if (c.type === 'flight') return cov.flight
  if (c.type === 'hotel') return cov.hotel
  const cats = c.categories ?? []
  const trips = c.tripIds ?? []
  if (cats.length === 0 && trips.length === 0) return cov.transports.length > 0
  return cov.transports.some(t => trips.includes(t.tripId) || cats.includes(t.category))
}

function describe(c: RequiredComponent): string {
  if (c.type !== 'transport') return NAMES[c.type]
  const cats = c.categories ?? []
  const trips = c.tripIds ?? []
  if (cats.length === 0 && trips.length === 0) return 'transport'
  const parts = [cats.length > 0 ? `kategori ${cats.join(', ')}` : '', trips.length > 0 ? `${trips.length} rute tertentu` : ''].filter(Boolean)
  return `transport (${parts.join(' atau ')})`
}

/**
 * Pelanggaran aturan visa untuk komponen booking yang ada. Tiap produk visa dievaluasi SEKALI (beberapa jamaah dengan visa yang sama = satu aturan).
 * Aturan tersimpan yang tak sah selalu `error` (fail-closed: data rusak tak boleh meloloskan booking diam-diam).
 */
export function evaluateVisaRules(visas: readonly VisaRuleSubject[], coverage: BookingCoverage, allowVisaWithoutBundle: boolean): RuleViolation[] {
  const out: RuleViolation[] = []
  const seen = new Set<string>()
  for (const v of visas) {
    if (seen.has(v.visaProductId)) continue
    seen.add(v.visaProductId)
    const { components, invalid } = parseRequiredComponents(v.requiredComponents)
    if (invalid) {
      out.push({ visaProductId: v.visaProductId, visaName: v.visaName, missing: 'rule', severity: 'error', message: `Aturan produk ${v.visaName} tidak valid — hubungi admin` })
      continue
    }
    for (const c of components) {
      if (satisfied(c, coverage)) continue
      out.push({
        visaProductId: v.visaProductId, visaName: v.visaName, missing: c.type,
        severity: allowVisaWithoutBundle ? 'warning' : 'error',
        message: `${v.visaName} mewajibkan ${describe(c)} dalam booking yang sama`,
      })
    }
  }
  return out
}

export const blockingViolations = (v: readonly RuleViolation[]): RuleViolation[] => v.filter(x => x.severity === 'error')
