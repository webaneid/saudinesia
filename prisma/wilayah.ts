// Data wilayah resmi Kemendagri (docs/arsitektur-alamat.md §10) — modul murni: membaca dump `prisma/data/wilayah.sql` (cahyadsn/wilayah, MIT)
// menjadi empat tingkat dan memeriksanya. Dipakai `prisma/apply-wilayah.ts` (image migrate, setiap deploy) dan `scripts/test-wilayah.ts`.

export type WilayahLevel = { table: string; parent: string | null; rows: WilayahRow[] }
export type WilayahRow = { id: string; name: string; parentId: string | null; type: string | null }

/** Jumlah baris per tingkat menurut sumber (Kepmendagri 300.2.2-2430/2025). Data baru = ubah angka ini bersama berkasnya. */
export const EXPECTED_COUNTS = [38, 514, 7285, 83762] as const

const TABLES = [
  { table: 'address_provinces', parent: null },
  { table: 'address_regencies', parent: 'provinceId' },
  { table: 'address_districts', parent: 'regencyId' },
  { table: 'address_villages', parent: 'districtId' },
] as const

// Baris data: ('11.01.01.2001','Keude Bakongan') — apostrof dieskep gaya SQL standar (''), mis. 'Pasi Kuala Ba''u'.
const ROW = /\('([0-9.]+)','((?:[^']|'')*)'\)/g

function regencyType(name: string): string {
  if (name.startsWith('Kota ')) return 'kota'
  if (name.startsWith('Kabupaten ')) return 'kabupaten'
  throw new Error(`nama kab/kota tanpa awalan yang dikenal: "${name}"`)
}

/** Empat tingkat berurutan induk → anak. Melempar bila kode ganda, induk tak ada, atau jumlah baris tidak sama dengan `expected`. */
export function parseWilayah(sql: string, expected: readonly number[] = EXPECTED_COUNTS): WilayahLevel[] {
  const levels: WilayahRow[][] = TABLES.map(() => [])
  const seen = new Set<string>()
  for (const m of sql.matchAll(ROW)) {
    const id = m[1]!, name = m[2]!.replace(/''/g, "'")
    const depth = id.split('.').length
    const level = levels[depth - 1]
    if (!level) throw new Error(`kode wilayah tak dikenal: ${id}`)
    if (seen.has(id)) throw new Error(`kode wilayah ganda: ${id}`)
    seen.add(id)
    level.push({ id, name, parentId: depth === 1 ? null : id.slice(0, id.lastIndexOf('.')), type: depth === 2 ? regencyType(name) : null })
  }
  for (const r of levels.flat()) if (r.parentId && !seen.has(r.parentId)) throw new Error(`induk wilayah ${r.id} tidak ada`)
  levels.forEach((rows, i) => { if (rows.length !== expected[i]) throw new Error(`${TABLES[i]!.table}: ${rows.length} baris di berkas, harap ${expected[i]}`) })
  return TABLES.map((t, i) => ({ ...t, rows: levels[i]! }))
}

/** SQL per tingkat; $1 = JSON baris. Tak pernah menghapus: alamat tersimpan merujuk baris ini (FK). */
export function wilayahStatements(l: Pick<WilayahLevel, 'table' | 'parent'>): { upsert: string; missing: string } {
  const cols = ['id', 'name', ...(l.parent ? [l.parent] : []), ...(l.table === 'address_regencies' ? ['type'] : [])]
  const src: Record<string, string> = { id: 'x.id', name: 'x.name', type: 'x.type', ...(l.parent ? { [l.parent]: 'x."parentId"' } : {}) }
  const from = 'jsonb_to_recordset($1::text::jsonb) AS x(id text, name text, "parentId" text, type text)'
  const rest = cols.slice(1)
  return {
    upsert: `INSERT INTO ${l.table} (${cols.map(c => `"${c}"`).join(', ')}) SELECT ${cols.map(c => src[c]).join(', ')} FROM ${from}
ON CONFLICT (id) DO UPDATE SET ${rest.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')}
WHERE (${rest.map(c => `${l.table}."${c}"`).join(', ')}) IS DISTINCT FROM (${rest.map(c => `EXCLUDED."${c}"`).join(', ')}) RETURNING 1 AS n`,
    missing: `SELECT count(*)::int AS n FROM ${from} LEFT JOIN ${l.table} t ON t.id = x.id AND ${rest.map(c => `t."${c}" = ${src[c]}`).join(' AND ')} WHERE t.id IS NULL`,
  }
}
