import { parseRequiredComponents, REQUIRED_COMPONENT_LABEL, type RequiredComponent, type RequiredComponentType } from '@/lib/validators/visa'

// Aturan booking (docs/arsitektur-booking-engine-v2.md D5, §4.1, §10.2). SATU tempat evaluasi — dipakai POST /bookings sekarang, form admin (Fase 5), dan front-end (Fase 11).
// Fungsi di sini MURNI: pemanggil mengumpulkan komponen booking (item + isi paket) lebih dulu, lalu meneruskannya ke sini.

/**
 * Komponen yang ADA di booking: dari item mandiri, isi Paket Umroh (`included`, atau `user_choice` yang sudah dipilih) dan isi Paket Ziarah yang benar-benar ditagih.
 * Dikumpulkan `bookingCoverage` (ruleContext.ts); di sini hanya dinilai.
 */
export type BookingCoverage = {
  flight: boolean
  hotelCities: ReadonlyArray<'makkah' | 'madinah'>
  transports: Array<{ tripId: string; category: string }>
  muthowif: boolean
  tour: boolean
  catering: boolean
}

export type VisaRuleSubject = { visaProductId: string; visaName: string; requiredComponents: unknown }

/** Setiap pelanggaran MENOLAK booking — aturan ditentukan produk visa, tak ada pelonggaran per pelanggan (docs/rencana-visa-produk.md §2.3). */
export type RuleViolation = {
  visaProductId: string
  visaName: string
  missing: RequiredComponentType | 'rule'
  /** Teks Indonesia (admin, `/id`) — rincian kategori transport hanya di sini. */
  message: string
  /** Kunci katalog `apiErrors` + parameter untuk pelanggan berbahasa lain (docs/arsitektur-i18n-frontend.md §6.8). */
  code: 'visaRequires' | 'visaRuleInvalid'
  params: { visa: string; component?: RequiredComponentType }
}

function satisfied(c: RequiredComponent, cov: BookingCoverage): boolean {
  switch (c.type) {
    case 'flight': return cov.flight
    case 'hotel_makkah': return cov.hotelCities.includes('makkah')
    case 'hotel_madinah': return cov.hotelCities.includes('madinah')
    case 'muthowif': return cov.muthowif
    case 'tour': return cov.tour
    case 'catering': return cov.catering
    case 'transport': {
      const cats = c.categories ?? []
      const trips = c.tripIds ?? []
      if (cats.length === 0 && trips.length === 0) return cov.transports.length > 0
      return cov.transports.some(t => trips.includes(t.tripId) || cats.includes(t.category))
    }
  }
}

function describe(c: RequiredComponent): string {
  const name = REQUIRED_COMPONENT_LABEL[c.type].toLowerCase()
  if (c.type !== 'transport') return name
  const cats = c.categories ?? []
  const trips = c.tripIds ?? []
  if (cats.length === 0 && trips.length === 0) return name
  const parts = [cats.length > 0 ? `kategori ${cats.join(', ')}` : '', trips.length > 0 ? `${trips.length} rute tertentu` : ''].filter(Boolean)
  return `${name} (${parts.join(' atau ')})`
}

/**
 * Pelanggaran aturan visa untuk komponen booking yang ada. Tiap produk visa dievaluasi SEKALI (beberapa jamaah dengan visa yang sama = satu aturan).
 * Aturan tersimpan yang tak sah selalu melanggar (fail-closed: data rusak tak boleh meloloskan booking diam-diam).
 */
export function evaluateVisaRules(visas: readonly VisaRuleSubject[], coverage: BookingCoverage): RuleViolation[] {
  const out: RuleViolation[] = []
  const seen = new Set<string>()
  for (const v of visas) {
    if (seen.has(v.visaProductId)) continue
    seen.add(v.visaProductId)
    const { components, invalid } = parseRequiredComponents(v.requiredComponents)
    if (invalid) {
      out.push({ visaProductId: v.visaProductId, visaName: v.visaName, missing: 'rule', message: `Aturan produk ${v.visaName} tidak valid — hubungi admin`, code: 'visaRuleInvalid', params: { visa: v.visaName } })
      continue
    }
    for (const c of components) {
      if (satisfied(c, coverage)) continue
      out.push({ visaProductId: v.visaProductId, visaName: v.visaName, missing: c.type, message: `${v.visaName} mewajibkan ${describe(c)} dalam booking yang sama`, code: 'visaRequires', params: { visa: v.visaName, component: c.type } })
    }
  }
  return out
}
