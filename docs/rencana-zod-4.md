# Rencana — migrasi `zod` 3.25 → 4.6 (SEC-211, tuntas)

> Status: **DIEKSEKUSI 2026-11-03 — as-built di §6.** Konteks: `docs/lessons-learned.md` SEC-211 (GHSA-mrhx-c7xc-m3w5, High), mitigasi lapis pertama sudah di Caddy (batas body 1 MB kecuali unggahan, PR #104 — **tetap dipertahankan** sebagai lapis kedua). Pelajaran proses yang berlaku: bump dependency diuji di **artefak produksi** (`bun server.js`), bukan hanya build/dev (CLAUDE.md § Security, `docs/lessons-learned.md` SEC-05).

## 1. Mengapa

Zod 3 memvalidasi SEMUA elemen array dan menumpuk satu issue per elemen yang gagal — `.max()` tidak menghentikannya. Perbaikan upstream hanya ada di zod ≥ 4.6.6: koleksi yang melebihi `.max()` ditolak SEBELUM satu elemen pun diparse (`capSize` di `zod/v4/core/schemas.js`).

**Temuan penting saat recheck:** perbaikan itu hanya melindungi koleksi yang **punya** `.max()`. Array tanpa batas tetap memparse setiap elemen di Zod 4. Recheck menemukan 7 array tanpa `.max()` + 1 record yang kuncinya bisa gagal per kunci — termasuk `createBookingSchema.items` di `POST /api/v1/bookings` (jalur jamaah). Jadi "tuntas" = bump **dan** membatasi koleksi itu, plus penjaga agar tidak tumbuh lagi.

## 2. Recheck permukaan pemakaian (kode, bukan asumsi)

- 91 berkas mengimpor `zod` (`lib/validators/` 20+ berkas, route handler, handler bersama, skrip uji). Satu-satunya pengguna lain di `node_modules`: `prisma` (dev, membawa zod 3 sendiri) — tidak terpengaruh.
- Bentuk galat ke klien: SELURUH route memakai pesan issue pertama — `{ success: false, error: issues[0].message }` (sebagian + `meta.field` = `path.join('.')`: dokumen, jamaah). Tidak ada `flatten()`/`format()`/`fieldErrors` di kode aplikasi.
- Pengujian runtime: probe yang mem-`safeParse` 15 masukan generik (`undefined`, `null`, `{}`, `[]`, string, angka, objek berkunci asing, …) terhadap SETIAP ekspor `lib/validators/` di zod 3 (worktree `origin/main`) dan zod 4, lalu membandingkan lolos/gagal + jalur issue.

## 3. Inventaris perubahan API

| API Zod 3 | Dipakai | Zod 4 | Tindakan |
|---|---|---|---|
| `ZodError.errors` | 73 tempat (`parsed.error.errors[0]?.message`) | dihapus → `.issues` (isi sama) | ganti mekanis ke `.issues`; bentuk respons tetap |
| `z.number({ invalid_type_error })` | 4 (`invoiceSettings.ts`) | dihapus → `{ error: fn }` | helper `typeError(msg)`: pesan hanya untuk tipe salah, kunci hilang tetap pesan bawaan (setara v3) |
| `z.literal(true, { errorMap })` | 3 (`auth.ts`, persetujuan) | `errorMap` dihapus → `{ error: '…' }` | ganti; berlaku untuk semua issue skema itu, sama seperti dulu |
| `z.ZodType<T, z.ZodTypeDef, unknown>` | 1 (`lib/invoice/listHandlers.ts`) | generik jadi `ZodType<Output, Input>` | `z.ZodType<T, unknown>` |
| `ZodEffects.innerType()` | 1 (uji) | `.superRefine()` tak lagi membungkus — tetap `ZodObject` | uji memakai `createBookingSchema.shape.items` |
| `.strict()` | 129 | tetap ada (deprecated → `z.strictObject`) | tidak diubah; probe membuktikan semua objek yang dulu menolak kunci asing tetap menolak (`unrecognized_keys`), termasuk turunan `.omit/.partial/.extend` |
| `.nullish()`, `.optional()`, `.default()` | 76 / banyak / 45 | `.default()` kini juga mengisi kunci opsional yang hilang, dan tidak memparse nilai bawaan | tak ada pola `.default().optional()` / `.partial()` atas skema berbawaan — perilaku sama |
| `z.string().email()/.uuid()/.url()/.datetime()/.date()` | banyak | tetap ada (deprecated → `z.email()` dst.); `uuid()` kini RFC 9562 ketat | tidak diubah; ID kita `gen_random_uuid()`/v4 → lolos; fixture uji yang memakai `00000000-0000-4000-8000-…` sah |
| `z.record(k, v)` | 2 (dua argumen) | satu-argumen dihapus | sudah dua argumen |
| `superRefine`, `refine`, `transform`, `ctx.addIssue`, `z.ZodIssueCode.custom`, `z.NEVER` | 13 / 37 / 12 / 27 | tetap ada (sebagian deprecated) | tidak diubah |
| `discriminatedUnion` | 4 | tetap | tidak diubah |
| `z.coerce`, `z.preprocess` | 68 / 5 | tipe masukan jadi `unknown` | tak ada galat tipe |
| Kode issue (`invalid_string`, `invalid_enum_value`, …) | **0** pemeriksaan kode issue di aplikasi | berganti nama | tak berdampak |

## 4. Perubahan perilaku yang TERLIHAT (diterima)

1. **Teks pesan BAWAAN Zod** (hanya bila skema tidak memberi pesan sendiri) berubah, mis. `Required` → `Invalid input: expected string, received undefined`, `Expected object, received null` → `Invalid input: expected object, received null`, `Unrecognized key(s) in object: 'x'` → `Unrecognized key: "x"`, `Invalid enum value. Expected …` → `Invalid option: expected one of …`. Bentuk respons (`error` = pesan issue pertama, `meta.field`) **tidak berubah**; semua pesan berbahasa Indonesia yang ditulis di skema tetap persis sama. Keduanya bahasa Inggris teknis — tidak dipetakan ulang (menambah peta global = permukaan baru tanpa manfaat bagi pengguna).
2. `z.string().min(n)` atas masukan bukan-string kini menambah issue ke-2 (`too_small`) setelah `invalid_type` — issue pertama tetap `invalid_type`, jadi pesan ke klien sama (probe: `fullNameSchema`/`passwordSchema` dengan array).

## 5. Langkah eksekusi

1. `bun add zod@^4.6.7` (4.6.7, terbit 2026-10-12; satu-satunya paket yang berubah di `bun.lock`).
2. Perbaikan API §3 sampai `tsc` 0 galat.
3. Batasi koleksi tanpa batas (§1) — batas = ukuran wajar formulir admin, bukan aturan bisnis.
4. Penjaga `scripts/test-zod-bounds.ts` (masuk `bun run test`): versi ≥ 4.6.6; penjelajah pohon skema atas semua ekspor `lib/validators/` (array tanpa `.max()` / record yang bisa gagal per kunci = merah); penjaga sumber untuk skema lokal route; uji ukur body 7,8 MB.
5. Bukti: `bun run build`, `bun run test` (DB tmp), `bun audit`, uji ukur memori, dan uji `bun server.js` (artefak produksi) dengan body kebesaran + respons galat field-level.

## 6. As-built (2026-11-03)

Lihat entri `docs/decisions.md` 2026-11-03 "Migrasi Zod 4" untuk angka bukti. Ringkas:

| Ukur (body 7,8 MB `{"items":[{},…]}` → `bookingDraftSchema`, `items.max(50)`) | zod 3.25.76 | zod 4.6.7 |
|---|---|---|
| Jumlah issue | 2.600.002 | 2 |
| Waktu `safeParse` | 1.742 ms | 1 ms |
| RSS puncak proses | 2,48 GB | 0,39 GB (tak naik dari sebelum parse) |
