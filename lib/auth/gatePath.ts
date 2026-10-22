// Murni (tanpa I/O, tanpa Node API) — aman untuk bundel Edge middleware.

/**
 * Path yang dilihat gerbang = path yang akan dirender. next-intl mengkanonikalkan path (decodeURI, buang tab/CR/LF, `\` → `/`, kompres `/+`)
 * lalu me-REWRITE ke bentuk kanonik; gerbang yang membaca path MENTAH (`/id/%61dmin`, `/id//admin`, `/id/%09admin`, `/id/\admin`) tidak mengenali
 * `/admin` dan meloloskannya, padahal yang dirender halaman admin (S-NI01; ada sejak v3 — terbukti identik di v3 dan v4). Di sini dikanonikalkan
 * SEBELUM mencocokkan: decodeURI berulang (maks 3, menangkap `%2561`) — `%2F` sengaja TIDAK didekode (karakter terpelihara) sehingga
 * `/admin%2Flogin` tak bisa memakai pengecualian `/admin/login`. Encoding rusak → dipakai apa adanya.
 */
export function canonicalGatePath(raw: string): string {
  let p = raw
  for (let i = 0; i < 3; i++) {
    let next: string
    try { next = decodeURI(p) } catch { break }
    if (next === p) break
    p = next
  }
  return p.replace(/[\t\n\r]/g, '').replace(/\\/g, '/').replace(/\/+/g, '/')
}
