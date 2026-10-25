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

`description` di Paket Umroh, Paket Ziarah, Situs Wisata, Katering (dan `HotelService.description`/instruksi dokumen bila ingin) — tiap kolom cukup mengganti `<textarea>` + validator + titik tampil. Sudah dipasang: Visa (Fase 2), Hotel, Muthowif (kolom `bio`), Haji (Fase 3, §8). Tabel bisa ditambah di `schema.ts` + toolbar bila ada modul yang butuh.

## 7. Hasil eksekusi (2026-10-23)

**Fase 1 — komponen.** Berkas persis seperti §3. `bun run typecheck` dan `bun run build` (di salinan terpisah supaya tidak merusak `.next` server dev) 0 error. `scripts/test-rich-text.ts` (16 tes, masuk `bun run test`/CI): daftar putih (tautan, gambar, tabel, H1, atribut liar, `constructor`/`__proto__`, kedalaman/jumlah node/panjang), salinan bersih membuang properti liar, `emptyToNull`, `plainText`, tampilan meng-escape teks berbahaya. **Dimutasi**: melonggarkan daftar putih → 3 tes gagal. Review keamanan: 0 temuan pada kode Fase 1.

**Fase 2 — halaman Visa.** Redesain tiga tab + `Switch`/`Tabs` baru di `components/admin/ui/` (lihat `docs/arsitektur-visa.md` §6 untuk struktur halaman). Diuji di browser (desktop dan 375 px): mengetik judul/paragraf/daftar, simpan, data tersimpan sebagai JSON bersih, katalog publik `/id/visa` menampilkannya, layar penuh + Esc, bilah simpan + Batalkan. API menolak (400, pesan jelas) tautan, gambar, H1, kunci tak dikenal, JSON rusak, dan isi >100.000 karakter; tanpa login → 403.

**Penyimpangan dari rencana (semua disengaja):**
1. **Override `prosemirror-model`/`prosemirror-transform` ditambahkan** (SEC-60 di `docs/lessons-learned.md`): editor pertama kali dijalankan memunculkan `multiple versions of prosemirror-model were loaded` karena `bun.lock` menyimpan salinan bersarang usang dari bump SEC-05. Diperbaiki, diverifikasi di artefak produksi (`bun server.js`), dijaga tes terhadap `bun.lock`.
2. Layar penuh memakai `!m-0`: induk `space-y-*` memberi `margin-top` pada anak sehingga `fixed inset-0` bergeser 12 px. Portal ke `document.body` tidak dipakai (menjaga satu pohon DOM dan token tema admin); konsekuensinya komponen tidak boleh berada di dalam leluhur ber-`transform`/`filter`.
3. Tabel tidak ditambahkan (lebih ringan, sesuai permintaan "minimalis").
4. Form buat produk di halaman daftar Visa tetap `<textarea>` teks polos (sah; berubah jadi editor saat halaman edit dibuka) — di luar permintaan.

## 8. Fase 3 — Hotel, Muthowif, Haji (2026-10-23)

| Modul | Kolom | Admin (editor) | Tampil |
|---|---|---|---|
| Hotel | `Hotel.description` | `hotels/[id]` dan form buat di `hotels/page.tsx` | detail publik `RichTextView` |
| Muthowif | `Muthowif.bio` (tidak ada kolom `description`) | `muthowif/[id]` dan form buat di `muthowif/page.tsx` | detail publik `RichTextView`; **beranda dan daftar memakai `plainText(bio)`** (kartu ber-`line-clamp`, JSON tidak boleh bocor) |
| Haji | `HajiProduct.description` | form buat di `haji/page.tsx` | **tidak ditampilkan di mana pun** (halaman publik Haji memang belum menampilkan deskripsi) |

Server: `richTextField().nullish()` + `emptyToNull()` di POST/PUT Hotel dan Muthowif; Haji memakai `hajiProductCreateSchema` baru (`.strict()`, di `lib/validators/adminUpdates.ts`) dan skema ubah yang batas `string maks 5000`-nya diganti `richTextField()` (JSON dokumen jauh lebih panjang dari teksnya; batas lama akan menolak deskripsi panjang yang sah).

**Perbaikan yang menumpang di Haji:** `POST /admin/products/haji` dulu membaca body mentah tanpa Zod (`+b.year` → NaN, tipe liar langsung ke Prisma) dan `catch → 403` untuk semua galat; kini tervalidasi dan galat dibedakan. `GET` daftar dan `DELETE` Haji ikut dibenahi dari `catch → 403` (id tak dikenal → 404).

**Batasan yang diketahui:**
1. Kontrak API katalog publik (`/api/v1/catalog/hotels|muthowif|visa`) mengembalikan kolom itu **apa adanya**: data lama = teks polos, data yang diedit lewat editor = string JSON dokumen. Tak ada konsumen di dalam aplikasi (diperiksa); konsumen luar harus memakai `RichTextView`/`plainText()`. Bila konsumen luar muncul, tambahkan field turunan teks polos (mis. `descriptionText`) alih-alih mengubah kolomnya.
2. Admin Haji hanya punya form **buat** dan tombol aktif/nonaktif — belum ada halaman edit, jadi deskripsi Haji yang sudah ada hanya bisa diubah lewat `PUT /admin/products/haji/[id]`.
3. Halaman publik Haji belum menampilkan deskripsi; menampilkannya (ringkasan `plainText` pada kartu) adalah keputusan produk tersendiri.
4. Teks polos lama (semua data sekarang) dibuka di editor sebagai paragraf per baris dan baru berubah menjadi JSON saat disimpan.

**Verifikasi (browser dev):** teks lama termuat di editor Hotel dan Muthowif, ditambah daftar/judul lalu disimpan → JSON bersih di DB → tampil benar di detail publik; beranda dan daftar Muthowif menampilkan ringkasan teks polos tanpa JSON; produk Haji dibuat lewat UI dengan deskripsi H3 + paragraf. API menolak (400) tautan di keenam jalur (Hotel/Muthowif/Haji × POST/PUT), kunci liar (`bookedQuota`), tipe salah, dan body null di Haji POST. `scripts/test-rich-text.ts` kini 17 tes (+skema Haji). Data uji dibersihkan/dipulihkan.

## 9. Fase 4-8 — Haji publik, Paket Umroh, Paket Ziarah, Situs Wisata, Katering (rencana 2026-10-25)

Keputusan pemilik (2026-10-25): deskripsi Haji **tampil di halaman publik**; editor dipasang di Paket Umroh, Paket Ziarah, Situs Wisata, dan Katering; temuan keamanan lama (SEC-07, SEC-08, dst.) **diagendakan untuk sesi berikutnya**, tidak dikerjakan sekarang.

**Hasil recheck kode (sebelum merancang):**

| Modul | Kolom | Admin sekarang | Tampil publik sekarang |
|---|---|---|---|
| Haji | `HajiProduct.description` | form buat (editor sudah, §8) | **tidak ada** → ditambah (Fase 4) |
| Paket Umroh | `Package.description` | `packages/[id]` + form buat di `packages/page.tsx` (`<textarea>`) | `packages/page.tsx` kartu: `<p>{pkg.description}</p>` |
| Paket Ziarah | `TourPackage.description` | `tour-packages/[id]` + form buat (`<textarea>`) | `tours/page.tsx` kartu: `<p>{p.description}</p>`; API katalog mengembalikan apa adanya |
| Situs Wisata | `TourismSite.description` | `tourism-sites/[id]` + form buat (`<textarea>`) | **tidak ditampilkan** (halaman publik hanya nama/foto/kota/peta; deskripsi hanya di API katalog) |
| Katering | **tidak ada kolom** (`CateringOption`: nama, tipe, gaya menu, 3 harga) | form buat saja (tanpa halaman edit) | kartu: nama + badge + harga |

**Rencana per fase (satu fase satu waktu; tiap fase: typecheck, `bun run build` di salinan terpisah, uji browser + uji penolakan API, security check, dokumentasi):**

| Fase | Isi | Catatan |
|---|---|---|
| 4 | Halaman publik Haji menampilkan `description` lewat `RichTextView` di kartu | tanpa perubahan skema/API |
| 5 | Paket Umroh: admin (edit + buat) → `RichTextEditor`; validator POST/PUT → `richTextField()`+`emptyToNull`; kartu publik → `RichTextView` | |
| 6 | Paket Ziarah: sama; API katalog tidak diubah (kontrak §8) | |
| 7 | Situs Wisata: admin (edit + buat) + validator saja | Tampil publik **tidak** ditambah (keputusan produk terpisah; dicatat sebagai batasan) |
| 8 | Katering: **migrasi aditif** `catering_options.description TEXT NULL` (aman, nullable) + form buat → editor + validator + tampil di kartu publik | Migrasi lewat alur non-interaktif (shadow DB sekali pakai berurutan literal, lihat memori proyek); CI memeriksa skema=migrasi |

**Di luar cakupan (sengaja):** halaman edit produk Haji dan Katering di admin (form buat saja), `HotelService.description`, API katalog (tetap apa adanya), penurunan hotel/transport di komponen paket. Agenda temuan lama (SEC-07/08/12/13/14/35/43/47/49/50/61b/10/11) dicatat di `docs/progress.md` sebagai "Agenda sesi berikutnya".

### 9.1 Hasil per fase

- **Fase 4 — Haji publik (2026-10-25):** `(public)/haji/page.tsx` menampilkan `description` lewat `RichTextView` di bawah nama/jenis. Diuji di browser: teks polos lama ("Haji furoda ini boss") tampil apa adanya; isi kaya (H3 + daftar + tebal, disisipkan sementara lalu dipulihkan) tampil benar; tanpa JSON bocor. Build produksi (salinan terpisah) 0 error. Security: 0 temuan (Server Component, tanpa API/dependensi baru). Batasan §8 butir 3 ("halaman publik Haji belum menampilkan deskripsi") **tertutup**.

