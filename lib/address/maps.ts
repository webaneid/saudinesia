// Lokasi Google Maps untuk alamat (docs/arsitektur-hotel.md §12.5) — TANPA API key: admin mencari lewat Maps URLs publik lalu menempelkan tautan "Bagikan".
// Murni (aman di server dan klien). Tautan ini tampil di halaman publik → hanya https ke host Google Maps yang diizinkan; tak pernah diambil (fetch) server.

export const MAPS_URL_MAX = 2000

const GOOGLE_HOST = /^(www\.)?google\.(com|co\.id|com\.sa)$/ // tautan /maps di domain Google utama, Indonesia, Arab Saudi
const SHORT_HOSTS = new Set(['maps.app.goo.gl']) // tautan "Bagikan" aplikasi
const MAPS_HOSTS = new Set(['maps.google.com', 'maps.google.co.id', 'maps.google.com.sa'])

export type MapsLocation = { url: string; latitude: number | null; longitude: number | null }
export type MapsParse = { ok: true; value: MapsLocation } | { ok: false; message: string }

const coord = (lat: string, lng: string): { latitude: number; longitude: number } | null => {
  const latitude = Number(lat), longitude = Number(lng)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 }
}

/** Koordinat dari tautan panjang: pin tempat (`!3dLAT!4dLNG`), lalu pusat peta (`@LAT,LNG`), lalu `?q=`/`?query=` berupa "LAT,LNG". Tautan pendek → null. */
function coordinatesOf(u: URL): { latitude: number; longitude: number } | null {
  const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'
  let href = u.href
  try { href = decodeURIComponent(href) } catch { /* % rusak → pakai apa adanya */ }
  const pin = href.match(new RegExp(`!3d${NUM}!4d${NUM}`))
  if (pin) return coord(pin[1]!, pin[2]!)
  const at = u.pathname.match(new RegExp(`@${NUM},${NUM}`))
  if (at) return coord(at[1]!, at[2]!)
  const q = (u.searchParams.get('query') ?? u.searchParams.get('q') ?? '').match(new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`))
  return q ? coord(q[1]!, q[2]!) : null
}

/** Periksa tautan Google Maps yang ditempel admin. Ditolak: bukan https, host di luar daftar, kredensial/port di URL, terlalu panjang. */
export function parseMapsUrl(raw: string): MapsParse {
  const text = raw.trim()
  const bad = { ok: false as const, message: 'Tautan harus tautan Google Maps (https://maps.app.goo.gl/… atau https://www.google.com/maps/…)' }
  if (!text || text.length > MAPS_URL_MAX) return text ? { ok: false, message: 'Tautan Google Maps terlalu panjang' } : bad
  let u: URL
  try { u = new URL(text) } catch { return bad }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return bad
  const host = u.hostname.toLowerCase()
  const allowed = SHORT_HOSTS.has(host) || MAPS_HOSTS.has(host) || (GOOGLE_HOST.test(host) && (u.pathname === '/maps' || u.pathname.startsWith('/maps/')))
  if (!allowed) return bad
  const c = coordinatesOf(u)
  return { ok: true, value: { url: u.href, latitude: c?.latitude ?? null, longitude: c?.longitude ?? null } }
}

/** Tautan pencarian Google Maps (Maps URLs publik, tanpa key) — tombol "Cari di Google Maps" di admin. */
export function mapsSearchUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query.trim())}`
}
