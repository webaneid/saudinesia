// Tautan dari halaman PUBLIK/jamaah ke panel admin (catatan "kelola di panel admin" untuk staf, pengalihan staf dari halaman jamaah).
// Server saja. Mode domain (`ADMIN_DOMAIN` terisi): alamat absolut ke host admin (protokol mengikuti `APP_URL`); mode satu host:
// `/{locale}/admin/...`. Area publik tak boleh mengimpor `lib/admin` (scripts/test-table-consistency.ts), jadi helper ini terpisah dari
// `adminHref` — aturannya sama (docs/rencana-domain-admin.md §3.1).
export function staffPanelHref(locale: string, path: string): string {
  if (!/^\/admin(?=\/|$|\?)/.test(path)) throw new Error(`staffPanelHref: jalur harus diawali /admin (${path})`)
  const domain = (process.env.ADMIN_DOMAIN ?? '').trim().toLowerCase()
  if (!domain) return `/${locale}${path}`
  let proto = 'https:', port = ''
  try { const u = new URL(process.env.APP_URL ?? ''); proto = u.protocol; port = u.port ? `:${u.port}` : '' } catch { /* bawaan https */ }
  const rest = path.slice('/admin'.length)
  return `${proto}//${domain}${port}${rest.startsWith('/') ? rest : `/${rest}`}`
}
