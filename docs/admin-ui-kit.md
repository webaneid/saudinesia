# Admin UI Kit — adopsi pola smart-ai

> Status: **Fase 1 (2026-10-20), Fase 2 dan Fase 3 (2026-10-21) selesai & terverifikasi** (lihat `docs/progress.md` & `docs/decisions.md`).
> Sumber pola: project `smartai` (`apps/web/components/admin-shell/`, `components/ui/`, `components/auth/auth-shell.tsx`, ADR-0006 di repo itu).

## Tujuan

Admin Saudinesia memakai bahasa visual yang sama dengan admin smart-ai: palet hijau + emas lewat token terpusat, shell (sidebar bisa diciutkan + topbar + breadcrumb + drawer mobile), halaman login berlatar hijau, dan primitif UI seragam. Yang dipindah adalah **markup + pola**, bukan plumbing (smart-ai memakai Tailwind v4, better-auth, Eden API client, `usePermissions` — tidak ada yang cocok dengan stack di sini).

## Keputusan desain

- **Tailwind tetap v3.4** (tidak upgrade ke v4). Token `--admin-*` didefinisikan di `app/globals.css` sebagai channel RGB (`R G B`), lalu direferensikan di `tailwind.config.ts` sebagai `rgb(var(--x) / <alpha-value>)` supaya modifier opacity (`bg-admin-danger/10`) tetap jalan.
- **Satu-satunya tempat warna brand didefinisikan** = blok `--brand-*` di `globals.css`. Ganti brand = ubah blok itu.
- **Kit admin hidup di `components/admin/`** (`shell/`, `ui/`), bukan `components/ui/` — folder itu primitif shadcn yang dipakai situs publik, dan CLAUDE.md melarang impor silang admin ↔ pilgrim.
- **Jembatan warna legacy**: `teal`, `ink`, `canvas`, `line`, `gold`, `mint` dipakai juga di luar admin (halaman publik, `campaigns/`, `shared/media/`), jadi **tidak di-remap global**. Skala `teal` dibuat dari CSS variable dengan default = teal bawaan Tailwind, dan di-override jadi hijau brand hanya di dalam `.admin-root`. Jembatan ini sementara — hilang setelah Fase 3.
- **Class alias `admin-*`** (`admin-btn`, `admin-inp`, `admin-badge-*`, …) dipertahankan tapi diarahkan ke token baru, supaya 37 file admin yang ada tidak rusak selama migrasi.
- **Role constants** dipindah ke `lib/auth/roles.ts` (client-safe) dan di-re-export dari `lib/auth/session.ts`. Penyebabnya: form login (client) punya salinan sendiri `ADMIN_ROLES` yang tidak memuat `manager`.

## Fase

| Fase | Isi | Status |
|---|---|---|
| 1 | Token + utilitas CSS, `AdminAuthShell` + login, shell (Sidebar/Topbar/Breadcrumbs/UserDropdown/PageHeader), `ui/` (Button/Card/Badge/FormField), fix role `manager` di login | Selesai |
| 2 | `DataTable` + `Pagination` + `FilterPills` + `SearchForm` responsif (kartu di HP), pagination server-side di 6 list transaksional (menutup `take: 50` tanpa pagination) | Selesai & terverifikasi 2026-10-21 |
| 3a | Migrasi palet 44 file admin (`teal`/`slate`/`rose`/`amber`/`gold`/`mint`/`ink`/`canvas`/`line` → token `admin-*`), hapus jembatan `teal`, hapus `components/admin/AdminSidebar.tsx` | Selesai |
| 3b | Struktur: tabel list katalog → `DataTable` (kartu di HP), Overview → komponen kit | Selesai |

## Sengaja tidak dibawa dari smart-ai

- Pola SVG `pola-al-ikhlash` (aset brand institusi lain) — `panel-brand` di sini pakai gradien polos.
- `sonner` toast, `react-hook-form`, `Combobox`/`cmdk` — dependency baru, ditunda sampai ada halaman yang butuh (Fase 3).
- Kolom "Cari menu…" di sidebar lama dihapus: tidak pernah punya handler (dekorasi saja).

## Fase 2 — rancangan

**Cakupan.** List transaksional yang terus tumbuh: `bookings`, `visa`, `notifications`, `payments` (Server Component + Prisma), serta `system/users` dan `system/deletion-requests` (Client Component + API `GET`). List katalog produk (hotel, muthowif, dst.) adalah master data kecil dengan form inline — dimigrasi di Fase 3, bukan di sini.

**Paginasi lewat URL, bukan state.** `?page=&limit=` (+ filter `status`, `q`) — bisa di-bookmark, bisa dibagikan, dan tetap setelah reload. Halaman server membaca `searchParams`; halaman client membaca `useSearchParams()` lalu `router.replace`. Parsing satu tempat: `lib/admin/pagination.ts` (`parseListParams` — param rusak jatuh ke default, bukan 400/500; `paginate()` — hitung total dulu, lalu jepit `page` ke halaman terakhir supaya tidak pernah mendarat di halaman kosong). Dipakai juga oleh API route (`ok(items, meta)` — `data` tetap array, jadi konsumen lama tidak rusak).

**Komponen** (`components/admin/data-table/`, semuanya kompatibel Server Component — tanpa hook, jadi `cell: (row) => ...` boleh dilempar dari halaman server):
- `DataTable` — kolom dideklaratif; tabel di ≥md, **kartu di HP** (kolom pertama = judul, kolom ber-header = "label: nilai", kolom tanpa header = aksi di dasar kartu). Tanpa `@tanstack/react-table`: sort/seleksi/bulk tidak dibutuhkan satu pun halaman target (YAGNI).
- `Pagination` — mode tautan (`hrefFor`) untuk halaman server, mode tombol (`onPageChange`) untuk halaman client; jendela nomor halaman dengan elipsis; teks "Menampilkan x–y dari N".
- `FilterPills`, `SearchForm` — pola filter status yang tadinya diketik ulang per halaman; `SearchForm` memberi UI untuk param `q` di bookings yang sudah didukung query-nya tapi tidak pernah punya kotak cari.

**Perbaikan yang menumpang** (di baris yang memang ditulis ulang): filter `status` divalidasi terhadap daftar status yang dikenal (sebelumnya di-cast mentah → `?status=ngawur` menjadi 500 Prisma); urutan visa `id desc` (UUID — acak) diganti `submittedAt desc` (nulls terakhir) lalu `id` sebagai tie-breaker stabil. **Tidak** menambah kolom `createdAt` ke `VisaApplication` (perubahan skema, di luar scope).

**Catatan hasil eksekusi.** Rancangan di atas dieksekusi apa adanya; dua tambahan yang muncul saat verifikasi: `id` sebagai tie-breaker di semua `orderBy` list (data dengan timestamp kembar membuat halaman tidak stabil), dan validasi status memakai `hasOwnProperty` (bukan `in`, yang meloloskan `toString`). Bukti verifikasi lengkap di `docs/decisions.md` 2026-10-21.

## Fase 3 — rancangan

**Koreksi atas rencana awal.** Fase 1 menulis "hapus alias `admin-*`" di Fase 3. Itu dibatalkan: `admin-inp`/`admin-btn-sm`/`admin-th`/`admin-card`/`admin-form-panel`/dll dipakai ~560 kali, dan meng-inline-kan `@apply`-nya ke tiap elemen justru memperpanjang JSX — sedangkan CLAUDE.md menyuruh kombinasi class yang berulang diekstrak ke `@layer components`. Kelas-kelas itu jadi **kelas komponen permanen** kit (untuk form padat); komponen `Button`/`Card`/`Badge` dipakai untuk kode baru dan area yang disentuh. Yang dihapus hanya kelas **warna mentah** (di luar token) dan jembatan `teal`.

**3a — palet, mekanis (codemod, bukan tulis ulang tangan).** Histogram 44 file: `slate` 408×, `teal` 94×, `rose` 84×, `amber` 45×, `mint` 20×, `gold` 12×, `purple` 6×, `ink/canvas/line/shadow` ~450×. Semuanya dipetakan ke token berdasarkan **peran** (teks muted / aksen / bahaya / peringatan / ok / permukaan), dengan awalan varian (`hover:`, `focus:`, `md:`) dipertahankan. Aturan khusus: token `admin-line`/`admin-line-strong` sudah memuat alpha, jadi `border-line/70` → `border-admin-line` (modifier opacity tidak valid di Tailwind v3 untuk warna tanpa `<alpha-value>`). Overlay modal `style={{ background: rgba(...) }}` → `bg-admin-ink/40 backdrop-blur-*`; lebar progress dinamis (`style={{ width }}`) dibiarkan (tidak bisa diwakili Tailwind). `components/shared/media/*` ikut dimigrasi walau dipakai juga halaman pilgrim — keputusan brand hijau tidak membedakan area. `teal`, `ink`, `canvas`, `line`, `gold`, `mint` TETAP di `tailwind.config.ts` karena `components/campaigns/` dan halaman publik masih memakainya; yang dihapus hanya override variabel `teal` (jembatan) sehingga `teal` kembali ke bawaan Tailwind. `AdminSidebar.tsx` lama dihapus; diff retrofit di file itu hanya satu butir menu (`Hapus Akun`) yang sudah ada di `lib/admin/navigation.ts`.

**3b — struktur.** Tabel di halaman list katalog diganti `DataTable` (kartu di HP). **Tanpa pagination** untuk list katalog: itu master data kurasi yang kecil, dan API `GET`-nya juga dikonsumsi tanpa halaman oleh picker di halaman lain (mis. daftar hotel di builder paket) — memberi default `limit=20` akan memotong picker diam-diam. Ini pengecualian sadar dari aturan "semua list admin dipaginasi" di CLAUDE.md, dicatat di `docs/decisions.md`.

**Catatan hasil eksekusi Fase 3.** 3a dan 3b dieksekusi sesuai rancangan, dengan tiga penyimpangan sadar: (1) override `--primary`/`--ring` ber-scope `.admin-canvas` ditambahkan — tak terantisipasi di rancangan, ditemukan saat verifikasi visual (tombol `AddressPicker` masih biru karena memakai token shadcn semantik, bukan kelas palet); (2) `quotas` — daftar hotel ikut dipaginasi (sebelumnya `findMany` tanpa batas), bukan hanya diganti ke `DataTable`; (3) halaman detail `[id]` hanya dimigrasi palet-nya, bukan strukturnya. **Cara pakai untuk halaman baru:** shell/`PageHeader`/`Card`/`Badge`/`Button`/`FormField`/`DataTable` dari `components/admin/`; warna hanya lewat token `admin-*`; form padat boleh memakai kelas `admin-inp`/`admin-select`/`admin-btn-sm`/`admin-form-panel`; list transaksional wajib `lib/admin/pagination.ts`. Pengecualian pagination untuk katalog produk dijelaskan di `docs/decisions.md` 2026-10-21.
