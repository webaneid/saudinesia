# Arsitektur — Editor Teks Kaya (komponen universal)

> **Status: SELESAI & TERVERIFIKASI (2026-10-23)** — Fase 1 dan 2 dieksekusi (§7). Pola diadopsi dari smart-ai (`apps/web/components/editor/`,
> `apps/api/src/lib/teks-kaya.ts`, `docs/phases/phase-30-editor-teks.md`): minimalis, ringan, aman. Dua fase —
> Fase 1 komponen + validator + tes, Fase 2 dipasang di halaman admin Visa (`description`) + redesain halaman itu.

## 1. Tujuan

Kolom teks panjang (deskripsi produk) memakai editor yang layak, bukan `<textarea>`. Satu komponen, dipakai ulang di
modul mana pun lewat tiga baris kode, tanpa komponen itu tahu apa-apa soal entitas yang memakainya.

## 2. Keputusan

| Hal | Keputusan | Alasan |
|---|---|---|
| Mesin | Tiptap 3 (sudah terpasang 3.32, belum diimpor di mana pun) | Sudah di stack `CLAUDE.md`; paket tidak perlu ditambah |
| Format simpan | **JSON dokumen Tiptap dalam kolom `String`** yang sudah ada | Tanpa migrasi. Teks polos lama tetap sah (dibaca sebagai paragraf per baris) |
| Skema dibatasi | paragraf, H2/H3, tebal/miring/garis bawah, daftar berpoin/bernomor, `hardBreak` | Cukup untuk deskripsi panjang; tempelan berformat lain (warna, tautan, gambar) terbuang otomatis |
| Tanpa tabel/tautan/gambar | Disengaja | Lebih ringan; menambah satu node = ubah satu daftar putih (§4) |
| Tampilan | `RichTextView` memetakan JSON → elemen React, **tanpa Tiptap dan tanpa `dangerouslySetInnerHTML`** | Halaman publik tidak mengunduh editor; tidak ada jalur XSS lewat HTML |
| Muat editor | `next/dynamic` (`ssr: false`) dengan kerangka pemuatan | Hanya halaman yang memakai editor yang mengunduhnya (`docs/progress.md` M12) |
| Teks panjang | Tombol "layar penuh" di toolbar (satu instance editor, hanya wadahnya berubah) | Menulis panjang butuh ruang; tanpa dua editor yang harus disinkronkan |
| Token warna | Token shadcn standar (`border-input`, `bg-background`, `ring`), bukan `admin-*` | Komponen ada di `components/shared/` dan dipakai admin **dan** jamaah (preseden: `AddressPicker`); di admin otomatis hijau lewat override `.admin-canvas` |

## 3. Struktur berkas

```
components/shared/rich-text/
  RichTextEditor.tsx      # wrapper next/dynamic (yang diimpor pemakai)
  RichTextEditorImpl.tsx  # Tiptap + toolbar + layar penuh (dimuat dinamis)
  RichTextView.tsx        # JSON → React, aman dipakai di Server Component
lib/rich-text/
  doc.ts                  # client-safe: toDoc(), fromEditor(), hasContent(), plainText()
  schema.ts               # satu-satunya daftar putih node/mark/atribut (dipakai validator + tampilan)
lib/validators/richText.ts  # Zod: richTextField() — validasi + normalisasi sisi server
scripts/test-rich-text.ts   # tes validator (masuk `bun run test` dan CI)
app/globals.css           # kelas `.rich-text` di @layer components (tampilan + isi editor)
```

**API pemakai:**
```tsx
<RichTextEditor id="visa-description" value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))}
                placeholder="Jelaskan syarat, prosedur, dan catatan penting…" title="Deskripsi produk" />
// tampil (Server Component boleh):
<RichTextView value={product.description} />
```
Sisi API: `description: richTextField().nullish()` lalu `'' → null` (`emptyToNull`).

## 4. Keamanan

- Server **tidak pernah** menyimpan input mentah: `richTextField()` membangun salinan bersih (hanya `type/attrs/content/text/marks`
  yang diizinkan), menolak node/mark/atribut di luar daftar (tautan, gambar, H1, `script`, gaya), membatasi 5.000 node,
  kedalaman 12, panjang 100.000 karakter. Atribut tak dikenal pada node yang sah ikut terbuang (lebih ketat dari smart-ai).
- Tampilan memetakan hanya node yang diizinkan ke elemen React; node lain → `null`. Teks polos lama ditampilkan per baris.
- Daftar putih ada di satu tempat (`lib/rich-text/schema.ts`); skema editor di klien dan validator di server membaca daftar yang sama
  supaya tidak pernah menyimpang.
- Kanal tanpa format (WhatsApp/email/ekspor) memakai `plainText()`, bukan JSON mentah.

## 5. Fase

| Fase | Isi | Selesai bila |
|---|---|---|
| 1 | Komponen (editor, tampilan), helper, daftar putih, validator Zod, tes, CSS | `bun run build` 0 error, `scripts/test-rich-text.ts` hijau, security check |
| 2 | Halaman admin Visa: redesain + `description` memakai editor; `PUT/POST /admin/products/visa` memvalidasi lewat `richTextField()`; katalog publik `/visa` memakai `RichTextView` | Build 0 error, uji browser (desktop + HP), security check, dokumentasi |

## 6. Kandidat pemakaian berikutnya (belum dikerjakan)

`description` di Hotel, Muthowif, Haji, Paket Umroh, Paket Ziarah, Situs Wisata, Katering — tiap kolom cukup mengganti
`<textarea>` + validator + titik tampil. Tabel bisa ditambah di `schema.ts` + toolbar bila ada modul yang butuh.

## 7. Hasil eksekusi (2026-10-23)

**Fase 1 — komponen.** Berkas persis seperti §3. `bun run typecheck` dan `bun run build` (di salinan terpisah supaya tidak merusak `.next` server dev) 0 error. `scripts/test-rich-text.ts` (16 tes, masuk `bun run test`/CI): daftar putih (tautan, gambar, tabel, H1, atribut liar, `constructor`/`__proto__`, kedalaman/jumlah node/panjang), salinan bersih membuang properti liar, `emptyToNull`, `plainText`, tampilan meng-escape teks berbahaya. **Dimutasi**: melonggarkan daftar putih → 3 tes gagal. Review keamanan: 0 temuan pada kode Fase 1.

**Fase 2 — halaman Visa.** Redesain tiga tab + `Switch`/`Tabs` baru di `components/admin/ui/` (lihat `docs/arsitektur-visa.md` §6 untuk struktur halaman). Diuji di browser (desktop dan 375 px): mengetik judul/paragraf/daftar, simpan, data tersimpan sebagai JSON bersih, katalog publik `/id/visa` menampilkannya, layar penuh + Esc, bilah simpan + Batalkan. API menolak (400, pesan jelas) tautan, gambar, H1, kunci tak dikenal, JSON rusak, dan isi >100.000 karakter; tanpa login → 403.

**Penyimpangan dari rencana (semua disengaja):**
1. **Override `prosemirror-model`/`prosemirror-transform` ditambahkan** (SEC-60 di `docs/lessons-learned.md`): editor pertama kali dijalankan memunculkan `multiple versions of prosemirror-model were loaded` karena `bun.lock` menyimpan salinan bersarang usang dari bump SEC-05. Diperbaiki, diverifikasi di artefak produksi (`bun server.js`), dijaga tes terhadap `bun.lock`.
2. Layar penuh memakai `!m-0`: induk `space-y-*` memberi `margin-top` pada anak sehingga `fixed inset-0` bergeser 12 px. Portal ke `document.body` tidak dipakai (menjaga satu pohon DOM dan token tema admin); konsekuensinya komponen tidak boleh berada di dalam leluhur ber-`transform`/`filter`.
3. Tabel tidak ditambahkan (lebih ringan, sesuai permintaan "minimalis").
4. Form buat produk di halaman daftar Visa tetap `<textarea>` teks polos (sah; berubah jadi editor saat halaman edit dibuka) — di luar permintaan.
