# Arsitektur — Tabel, filter, aksi, dan paginasi yang seragam

> Status: **RENCANA (2026-10-30) — Fase 1 SELESAI; fase 2–5 menunggu satu per satu.** Arahan pemilik: satu desain tabel di semua tempat, kartu bertumpuk di HP, filter berupa dropdown dengan autocomplete (bukan tab/pil), kolom aksi berikon, paginasi seragam. Role user (menu Pelanggan/peran) sengaja dikerjakan terakhir.
> Dasar: `docs/admin-ui-kit.md` (Fase 2–3 lama, 2026-10-21). Dokumen itu menyebut kit sudah selesai; recheck langsung ke kode (SOP langkah 1) menemukan drift di bawah.

## 1. Recheck — kode aktual (2026-10-30)
Komponen kit ada di `components/admin/data-table/` (`DataTable`, `Pagination`, `FilterPills`, `SearchForm`, `useListPage`) dan bekerja baik sebagai fondasi: tabel ≥ md, kartu di HP, paginasi berbasis URL. Yang TIDAK seragam:

| Aspek | Temuan |
|---|---|
| Pemakaian tabel | 21 halaman admin + `CategoryManager` memakai `DataTable`. **`payments/page.tsx` membuat daftarnya sendiri** (`bookings.map`, bukan `DataTable`). Tabel mentah `<table>` masih ada di publik: `(public)/flight`, `(public)/hotels/[id]`, dan `components/campaigns/CampaignTable.tsx` (punya `Pagination` sendiri + `FilterBar` sendiri — dunia terpisah). |
| Paginasi | Ada di 12 halaman transaksional. **13 daftar katalog tidak berpaginasi** (catering, flight, haji, hotels, muthowif, packages, seasons, tour-packages, tourism-sites, transport (2 tabel), visa, `CategoryManager`) — pengecualian sadar 2026-10-21 karena API `GET`-nya dikonsumsi tanpa halaman oleh picker. Arahan baru membatalkan pengecualian itu untuk tampilan tabel (picker tetap harus utuh). |
| Filter | `FilterPills` (pil/tab) di 4 halaman (bookings, customers, vendors, visa); `<select>` polos di margin, vendors, muthowif, users; kotak cari hanya di 3 halaman. Tidak ada satu bentuk. |
| Kolom aksi | Tiap halaman menulis sendiri: tombol teks "Edit", "Kelola", "Nonaktifkan", ikon+teks, `<a>` vs `<button onClick={router.push}>`. Tak ada ikon Hapus di daftar manapun (hapus hanya di halaman edit). Hapus memakai `window.confirm` (users). |
| Paginasi tampilan | Elipsis dengan tetangga ±1 + ujung 1 halaman; tak ada mode ringkas di HP. |

## 2. Keputusan desain (asumsi — mohon dikoreksi)
1. **Satu kit** di `components/admin/data-table/` dan `components/admin/ui/`; halaman tak lagi menulis tabel/filter/aksi/paginasi sendiri.
2. **Tabel**: gaya tetap `DataTable` (token `admin-*`). Kolom aksi ditandai `actions: true` (lebar pas, rata kanan, judul "Aksi", di HP pindah ke dasar kartu). Mobile = kartu bertumpuk (sudah ada, dipertahankan).
3. **Filter** = `FilterSelect`: dropdown dengan kotak ketik (autocomplete, WAI-ARIA combobox/listbox, panah/Enter/Esc), pilihan "Semua" untuk mengosongkan. Satu `FilterBar` membungkus kotak cari + semua `FilterSelect` + tautan "Atur ulang". `FilterPills` dipensiunkan (dihapus setelah halaman terakhir migrasi). Filter tetap hidup di URL (bisa di-bookmark); filter mengembalikan ke halaman 1. Tab hanya untuk memisahkan bagian halaman, bukan menyaring data.
4. **Aksi berikon** (`RowActions`, hanya ikon + `title`/`aria-label` teks; satu tempat memetakan ikon di `ACTION_ICONS`): Lihat = `FileSearch`, Edit = `Pencil`, Hapus = `Trash2`, Aktifkan = `Eye`, Nonaktifkan = `EyeOff` (ikon menunjukkan AKSI, bukan status; status tetap di `Badge`). Hanya aksi yang BENAR-BENAR didukung modulnya yang ditampilkan (aturan CRUD lengkap CLAUDE.md: hapus bersemantik aman; nonaktifkan bila dirujuk). Hapus selalu lewat `ConfirmDialog` (modal), bukan `window.confirm`. Server Component tak boleh melempar fungsi ke komponen klien, jadi aksi tautan (`ActionLink`) server-safe, aksi bermutasi (`ApiAction`: hapus/toggle lewat `fetch` + `router.refresh()`) komponen klien yang menerima `url`/`method`/`body` biasa.
5. **Paginasi** (satu `Pagination`): panah-kiri, `1 2 3 … n-2 n-1 n` dengan halaman aktif ±1 (celah satu halaman diisi, bukan elipsis), panah-kanan; di HP ringkas "‹ 5 / 22 ›". Teks "Menampilkan x–y dari N" tetap. Semua daftar yang bisa tumbuh memakainya; **katalog**: API `GET` mendukung `?page&limit` **opt-in** (tanpa parameter = utuh seperti sekarang, jadi picker tak rusak) dan halaman tabel meminta halaman.
6. Tabel publik/campaign (§1) dibahas terpisah di Fase 4 — kit admin memakai token `admin-*` dan CLAUDE.md melarang impor admin ↔ pilgrim; butuh varian bersama di `components/shared/`.

## 3. Fase (satu fase, satu PR, SOP penuh)
| Fase | Isi | Status |
|---|---|---|
| 1 | Kit: `Pagination` baru, `FilterSelect` + `FilterBar`, `RowActions`/`ActionLink`/`ActionButton`/`ApiAction`/`ConfirmDialog`, flag `actions` di `DataTable`; percontohan: **Pelanggan dan Booking** (server) + **Pengguna** (klien: toggle + dialog). | **SELESAI & TERVERIFIKASI 2026-10-30** (§4) |
| 2 | Migrasi daftar transaksional: visa, payments (→ `DataTable`), quotas, notifications, margin, reports, variance, system/{users, vendors, deletion-requests} (client/server); `FilterPills` dihapus. | Menunggu |
| 3 | Daftar katalog (13 tabel): API opt-in paginasi + `DataTable` + aksi ikon (lihat/edit/hapus/aktifkan) sesuai dukungan modul. | Menunggu |
| 4 | Audit sisa (tabel di dalam halaman edit, daftar jamaah/dashboard, Overview), tabel publik (`flight`, `hotels/[id]`) dan `CampaignTable`: varian bersama. | Menunggu |
| 5 | Penjaga otomatis (`scripts/test-table-kit.ts`): tak ada `<table>` mentah di admin, tiap daftar berpaginasi atau terdaftar sebagai pengecualian, tak ada `FilterPills`/`window.confirm`, kolom aksi memakai `RowActions`; aturan masuk `CLAUDE.md`. | Menunggu |

## 4. As-built Fase 1 (2026-10-30)
- **Komponen baru** (`components/admin/data-table/`, `components/admin/ui/`): `FilterSelect` (klien; combobox ARIA, panah/Enter/Esc, mode `nav` untuk halaman server — props data biasa, tautan dibangun di klien — atau `onChange` untuk halaman klien), `FilterBar` (server-safe; pencarian + dropdown + "Atur ulang"), `RowActions`/`ActionLink`/`ActionButton` (server-safe; `ACTION_ICONS`/`ACTION_LABELS` satu tempat), `ApiAction` (klien; hapus dengan `ConfirmDialog`, aktif/nonaktif langsung; sukses → `router.refresh()` + `onDone` untuk halaman klien), `ConfirmDialog` (pengganti `window.confirm`), helper murni `lib/admin/filter.ts` (`filterOptions`, `filterHref`).
- **`Pagination`**: panah-kiri, tiga halaman di tiap ujung + aktif ±1 (celah satu halaman diisi angka), panah-kanan; HP: ringkas "4 / 10". **`DataTable`**: flag `actions` (judul "Aksi", rata kanan, lebar pas, dasar kartu di HP).
- **Percontohan**: Pelanggan dan Booking (FilterPills → FilterBar + FilterSelect, kolom aksi Lihat), Pengguna (aksi Edit/Lepas WhatsApp/Buka pembatasan/Aktif-Nonaktif berikon; `window.confirm` → `ConfirmDialog`).
- **Bukti:** `scripts/test-table-kit.ts` (tabel nilai `pageWindow` dihitung tangan, autocomplete, tautan filter, render nyata Pagination/DataTable/RowActions, penjaga sumber halaman bermigrasi) + 7 mutasi tertangkap; Chrome + server dev: dropdown mengetik "non" → Enter → URL `?active=inactive` (halaman kembali ke 1, `limit` terjaga, "Atur ulang" muncul), paginasi "1 2 3 … 6 [7] 8 … 13 14 15", kartu HP bertumpuk dengan aksi di dasar, paginasi HP "4 / 10", toggle Aktif/Nonaktif di Pengguna mengubah status, dialog konfirmasi Lepas WhatsApp.
- **Belum diverifikasi di browser:** jalur hapus `ApiAction` (belum ada halaman yang memakainya; diuji nyata di Fase 3) dan dialog galat toggle.
