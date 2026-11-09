// Ringkasan pesanan "pakai rumus" (permintaan pemilik 2026-11-10): baris yang identik — produk, keterangan, dan harga satuan sama —
// digabung jadi satu baris "Visa Umroh Longstay · 3 jamaah × Rp 6.250.000 = Rp 18.750.000", bukan tiga kotak yang sama.
// Murni (aman di server dan klien). Hanya MERINGKAS tampilan: jumlah per baris tetap Σ baris aslinya, jadi total tidak berubah.

export type SummaryInput = {
  /** Kelompok layanan (mis. "Visa"), ikut menentukan penggabungan. */
  group:  string
  name:   string
  detail: string
  /** Satuan hitungan saat digabung (mis. "jamaah"). */
  unit:   string
  amount: number
}

export type SummaryRow<T extends SummaryInput = SummaryInput> = {
  key:       string
  /** Baris asli pertama dalam kelompok (pemanggil bisa membaca kolom tambahannya). */
  first:     T
  group:     string
  name:      string
  detail:    string
  unit:      string
  count:     number
  unitPrice: number
  amount:    number
}

const cents = (n: number) => Math.round(n * 100)

/** Gabungkan baris identik (kelompok + nama + keterangan + satuan + harga satuan); urutan kemunculan pertama dipertahankan. */
export function collapseRows<T extends SummaryInput>(rows: readonly T[]): SummaryRow<T>[] {
  const out = new Map<string, SummaryRow<T>>()
  for (const r of rows) {
    const key = JSON.stringify([r.group, r.name, r.detail, r.unit, cents(r.amount)])
    const hit = out.get(key)
    if (hit) { hit.count += 1; hit.amount = (cents(hit.amount) + cents(r.amount)) / 100; continue }
    out.set(key, { key, first: r, group: r.group, name: r.name, detail: r.detail, unit: r.unit, count: 1, unitPrice: r.amount, amount: r.amount })
  }
  return [...out.values()]
}

/** Teks rumus untuk baris gabungan ("3 jamaah × Rp 6.250.000"); null bila hanya satu. `money` = pemformat Rupiah pemanggil. */
export function formulaOf(row: Pick<SummaryRow, 'count' | 'unit' | 'unitPrice'>, money: (n: number) => string): string | null {
  return row.count > 1 ? `${row.count} ${row.unit} × ${money(row.unitPrice)}` : null
}
