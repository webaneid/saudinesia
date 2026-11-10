// Tiket pulang di checkout (docs/arsitektur-booking-engine-v2.md §10.6, K11b-1 = b). Murni — dipakai pemuat opsi (yang ditawarkan) dan
// pemeriksaan server (yang diterima), supaya keduanya membaca aturan yang sama: jadwal pulang = rute KEBALIKAN jadwal berangkat.

type Route = { origin: string; destination: string }

const key = (s: string) => s.trim().toLowerCase()

/** `ret` adalah rute pulang untuk `dep`: asal pulang = tujuan berangkat dan tujuan pulang = asal berangkat (teks bebas admin, tanpa beda huruf/spasi tepi). */
export function isReturnRoute(dep: Route, ret: Route): boolean {
  return key(ret.origin) === key(dep.destination) && key(ret.destination) === key(dep.origin)
}
