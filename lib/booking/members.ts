import { ItemNotBookableError } from './errors'
// Anggota Paket Umroh / Haji per jamaah booking (docs/rencana-visa-produk.md §3.3, K2 "otomatis urut", K4 "visa dobel ditolak"). Fungsi di sini MURNI:
// pemanggil (lib/booking/lineItems.ts saat pesan, lib/booking/revise.ts saat revisi) memuat keadaan lalu menulis hasilnya — SATU aturan pembagian.
//
// Aturan:
// • Σ orang paket ≤ jumlah jamaah dan Σ orang haji ≤ jumlah jamaah (jika tidak → ditolak; dulu sisa visa paket diam-diam tak terbagi).
// • Anggota lama dipertahankan (sampai jumlah orang itemnya); kursi kosong diisi jamaah tanpa paket menurut urutan jamaah.
// • Paket bervisa diisi DULU, mendahulukan pemegang visa paket yang sama, lalu jamaah tanpa visa — sama dengan pembagian visa paket sebelum V4,
//   sehingga siapa yang mendapat visa paket tidak berubah. Paket tanpa visa mendahulukan jamaah tanpa visa paket (visa paketnya tak hilang sia-sia).
// • Anggota paket bervisa yang memegang visa SENDIRI (berbaris harga) → ditolak: visanya sudah termasuk paket (K4).

export type MemberSlot = { key: string; numPeople: number; /** Visa yang termasuk/dipilih di paket; null = paket tanpa visa. */ visaProductId: string | null }
export type MemberHaji = { key: string; numPeople: number }
export type MemberPilgrim = {
  key: string
  /** Visa milik sendiri (ditagih terpisah). */ ownVisa: boolean
  /** Visa dari paket yang SEKARANG dipegang (id produk), atau null. */ packageVisa: string | null
  currentPackage: string | null
  currentHaji: string | null
}
export type MemberAssignment = { package: string | null; haji: string | null }
export type MemberResult =
  | { ok: true; members: MemberAssignment[] }
  | { ok: false; reason: 'too_few_pilgrims'; what: 'package' | 'haji'; needed: number; pilgrims: number }
  | { ok: false; reason: 'double_visa'; pilgrimIndex: number; packageKey: string }

function fill<R extends { key: string; numPeople: number }>(
  rows: readonly R[], pilgrims: readonly MemberPilgrim[], current: (p: MemberPilgrim) => string | null, rank: (row: R, p: MemberPilgrim) => number,
): Array<string | null> {
  const known = new Set(rows.map(r => r.key))
  const out: Array<string | null> = pilgrims.map(p => { const c = current(p); return c && known.has(c) ? c : null })
  for (const row of rows) {
    // Anggota lama melebihi jumlah orang (jumlah diturunkan) → yang paling belakang dilepas.
    const kept = out.flatMap((k, i) => (k === row.key ? [i] : []))
    for (const i of kept.slice(row.numPeople)) out[i] = null
  }
  for (const row of rows) {
    let need = row.numPeople - out.filter(k => k === row.key).length
    if (need <= 0) continue
    const free = pilgrims.map((p, i) => ({ p, i })).filter(({ i }) => out[i] === null)
    free.sort((a, b) => rank(row, a.p) - rank(row, b.p) || a.i - b.i)
    for (const { i } of free) { if (need-- <= 0) break; out[i] = row.key }
  }
  return out
}

export function assignMembers(packages: readonly MemberSlot[], haji: readonly MemberHaji[], pilgrims: readonly MemberPilgrim[]): MemberResult {
  const n = pilgrims.length
  const pkgNeed = packages.reduce((s, r) => s + r.numPeople, 0)
  if (pkgNeed > n) return { ok: false, reason: 'too_few_pilgrims', what: 'package', needed: pkgNeed, pilgrims: n }
  const hajiNeed = haji.reduce((s, r) => s + r.numPeople, 0)
  if (hajiNeed > n) return { ok: false, reason: 'too_few_pilgrims', what: 'haji', needed: hajiNeed, pilgrims: n }

  // Paket bervisa lebih dulu (urutan asli di dalam kelompok).
  const ordered = [...packages.filter(r => r.visaProductId), ...packages.filter(r => !r.visaProductId)]
  const pkg = fill(ordered, pilgrims, p => p.currentPackage, (row, p) => (
    row.visaProductId
      ? (p.packageVisa === row.visaProductId ? 0 : !p.ownVisa && !p.packageVisa ? 1 : !p.ownVisa ? 2 : 3)
      : (!p.packageVisa ? (p.ownVisa ? 1 : 0) : 2)
  ))
  const visaOf = new Map(packages.map(r => [r.key, r.visaProductId]))
  for (const [i, key] of pkg.entries()) {
    if (key && visaOf.get(key) && pilgrims[i]!.ownVisa) return { ok: false, reason: 'double_visa', pilgrimIndex: i, packageKey: key }
  }
  const hj = fill(haji, pilgrims, p => p.currentHaji, () => 0)
  return { ok: true, members: pilgrims.map((_, i) => ({ package: pkg[i] ?? null, haji: hj[i] ?? null })) }
}

export type GroupedMemberResult = MemberResult | { ok: false; reason: 'mixed_groups' }

/**
 * Pembagian anggota untuk booking berrombongan (docs/arsitektur-booking-engine-v2.md §10.8 butir 3). Tanpa rombongan, atau semua paket/haji untuk SEMUA jamaah →
 * `assignMembers` atas seluruh jamaah (perilaku lama). Paket/haji per rombongan → dibagi di dalam rombongannya sendiri (nomor jamaah di galat = nomor di booking).
 * Campuran "semua" + "per rombongan" ditolak — satu jamaah tak dapat memegang dua paket. Satu aturan untuk pesan baru dan revisi.
 */
export function assignInGroups(
  packages: ReadonlyArray<MemberSlot & { group?: number }>, haji: ReadonlyArray<MemberHaji & { group?: number }>,
  pilgrims: ReadonlyArray<MemberPilgrim & { group?: number }>, groupCount: number,
): GroupedMemberResult {
  const rows = [...packages, ...haji]
  if (groupCount === 0 || rows.every(r => r.group === undefined)) return assignMembers(packages, haji, pilgrims)
  if (rows.some(r => r.group === undefined)) return { ok: false, reason: 'mixed_groups' }
  const out: MemberAssignment[] = pilgrims.map(() => ({ package: null, haji: null }))
  for (let g = 0; g < groupCount; g++) {
    const idx = pilgrims.flatMap((p, i) => (p.group === g ? [i] : []))
    const r = assignMembers(packages.filter(x => x.group === g), haji.filter(x => x.group === g), idx.map(i => pilgrims[i]!))
    if (!r.ok) return r.reason === 'double_visa' ? { ...r, pilgrimIndex: idx[r.pilgrimIndex]! } : r
    idx.forEach((pi, k) => { out[pi] = r.members[k]! })
  }
  return { ok: true, members: out }
}

/** Galat berkode untuk pengguna (Jamaah ke-N dihitung dari 1) — kunci katalog `apiErrors` (docs/arsitektur-i18n-frontend.md §6.8). */
export function memberProblem(r: Exclude<GroupedMemberResult, { ok: true }>, packageName: (key: string) => string): ItemNotBookableError {
  if (r.reason === 'mixed_groups') return new ItemNotBookableError('membersMixed')
  if (r.reason === 'too_few_pilgrims') return new ItemNotBookableError('membersTooFew', { pilgrims: r.pilgrims, needed: r.needed, what: r.what })
  return new ItemNotBookableError('memberVisaIncluded', { number: r.pilgrimIndex + 1, package: packageName(r.packageKey) })
}
