// Kunci varian titik harga yang dipakai lebih dari satu modul mesin (tanpa impor lain — aman dari impor melingkar owners ↔ manual).

const DEPARTURE_PREFIX = 'dep:'

/** Kunci varian harga khusus satu keberangkatan Paket Umroh (K1 F4, docs/arsitektur-paket-umroh.md §8.5). */
export const departureVariantKey = (departureId: string) => `${DEPARTURE_PREFIX}${departureId}`

/** Id keberangkatan dari kunci varian, atau null bila bukan varian keberangkatan. */
export const departureIdOfKey = (key: string): string | null => (key.startsWith(DEPARTURE_PREFIX) ? key.slice(DEPARTURE_PREFIX.length) : null)
