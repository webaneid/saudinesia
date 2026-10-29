# Arsitektur — Komponen Kontak (Nomor HP / WhatsApp / Email)

> **Pembaruan 2026-10-22 (ADR-0001/0002, `docs/arsitektur-auth.md`):** bagian di bawah yang menyebut `User.phone` sebagai **identitas OTP** / `phone @unique` / `phoneVerifiedAt`, serta keputusan bahwa
> registrasi dan profil akun "TIDAK disentuh", adalah **keadaan SAAT ITU** dan sudah digantikan: OTP dihapus; `User` kini punya `phone` dan `whatsapp` (digit E.164, tidak unik; verifikasi WhatsApp lewat pesan masuk —
> `whatsappVerifiedAt`/`verifiedWhatsapp`); form daftar, halaman "Lengkapi Data", dan Profil memakai `ContactPicker` (`showEmail={false}`) + `contactFromStored`/`e164FromCountry`. `BookingPilgrim` (data kontak per jamaah)
> tetap terpisah dari kontak akun.

> **Status: SELESAI & TERVERIFIKASI (2026-07-23).** Komponen universal ke-5 (sejajar harga, dokumen, manifest, alamat) — satu blok "Data Kontak" reusable (kode negara autocomplete + Nomor HP + Nomor WhatsApp dengan checkbox "Sama dengan nomor HP" + Email), diwire ke wizard booking (`BookingPilgrim`). Mengikuti pola persis yang sama dengan `docs/arsitektur-alamat.md` (komponen dulu, baru diwire ke entity nyata). Lihat §10 untuk bukti verifikasi dan 2 bug nyata yang ditemukan+ditutup saat verifikasi (bukan cuma "kelihatan benar").

---

## 1. Konteks Bisnis

User minta komponen "Kontak" yang konsisten dipakai berulang (seperti Alamat), terdiri dari:
1. Kode negara dengan autocomplete (default Indonesia), bukan teks tetap "+62"
2. Nomor HP
3. Nomor WhatsApp + checkbox "Sama dengan nomor HP" (kalau dicentang, nomor DAN kode negaranya ikut disamakan)
4. Email — kalau pengguna sudah punya akun (daftar pakai email), field ini auto-terisi dari email akun

Referensi UI: panel "Data Kontak" — flag+kode negara di kiri tiap nomor, checkbox sync di bawah Nomor WhatsApp.

## 2. Riset Kode Aktual (2026-07-23)

Audit langsung (bukan asumsi) menemukan: **pola ini belum ada di manapun** — bukan cuma belum reusable, tapi UI-nya sendiri (2 nomor terpisah + checkbox sync + kode negara autocomplete) belum pernah dibangun. Yang ada hari ini jauh lebih sederhana dan **semuanya hardcode Indonesia**:

| Lokasi | Bentuk saat ini |
|---|---|
| `app/[locale]/(auth)/register/RegisterForm.tsx:151` | 1 field "Nomor WhatsApp", prefix `+62` tetap (`<span>`, bukan selector), WhatsApp = identitas OTP |
| `app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx:120-127` | 1 field "Nomor WhatsApp" per jamaah, prefix `+62` tetap, tidak ada "Nomor HP" terpisah |
| `app/[locale]/(pilgrim)/profile/ProfileForm.tsx:87` | Nomor **read-only** (`+{phone}`), tidak bisa diedit — terikat status verifikasi OTP |
| `prisma/schema.prisma` — `User` | `phone String? @unique` + `phoneVerifiedAt` — SATU kolom, WhatsApp-lah nomor ini (dipakai OTP), tidak ada kolom `whatsapp` maupun `countryCode` |
| `prisma/schema.prisma` — `BookingPilgrim` (baris 733) | `phone String?`, `email String?` — SATU kolom nomor, tidak ada `whatsapp`/`countryCode` |
| `lib/utils/phone.ts` | `normalizePhone()` — hardcode `62`, tidak sadar negara lain: `0xxx→62xxx`, selainnya `62+xxx` |
| `lib/whatsapp/client.ts` | `normalizePhone()` versi lain (duplikat logic, hardcode juga `0→62`) khusus payload ke GOWA |
| `lib/validators/auth.ts:15-19` | Regex longgar `/^[0-9+\s-]+$/`, 9-15 karakter — tidak validasi format per-negara |
| `lib/constants/countries.ts` | 195 negara (ISO alpha-2 + nama Indonesia) untuk tab Alamat Luar Negeri — **tidak ada kode panggilan telepon** |
| `docs/arsitektur-manifest.md` §3.1 (baris 83, RENCANA belum dieksekusi) | `fieldType='phone'` didefinisikan sebagai "format Indonesia (`+62`/`08xx`)" — asumsi ini SUPERSEDED oleh dokumen ini, lihat §7 |

**Kesimpulan riset:** ini genuinely komponen baru dari nol (bukan sekadar "jadikan reusable yang sudah ada", beda dari kasus Alamat yang ada cikal-bakalnya). Perlu dataset baru (kode panggilan telepon) yang belum ada di mana pun di repo.

## 3. Skema Baru (rencana)

### 3.1 Dataset kode panggilan telepon — **sudah dieksekusi** (bagian dari fase ini)

Bukan tabel DB baru — daftar `COUNTRIES` yang sudah ada di `lib/constants/countries.ts` (195 negara, ISO alpha-2 + nama) diperluas dengan field `dialCode` (kode panggilan ITU-T E.164, tanpa tanda "+"), satu sumber untuk dua kebutuhan (Alamat internasional tidak butuh `dialCode`, Kontak butuh keduanya `code`+`dialCode`) — menghindari 2 daftar negara paralel yang bisa drift. Flag bendera **tidak disimpan sebagai data** — dihitung dari `code` (ISO alpha-2) via konversi ke Unicode Regional Indicator Symbol (`lib/utils/flag.ts`, fungsi murni, tidak perlu API/gambar eksternal):
```ts
export function isoToFlagEmoji(iso2: string): string {
  return [...iso2.toUpperCase()].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('')
}
```

### 3.2 Tipe nilai komponen (`ContactValue`)

```ts
export type ContactValue = {
  phoneCountryCode: string   // ISO alpha-2, e.g. "ID" — default "ID"
  phone:            string   // nomor LOKAL saja (tanpa kode negara), digit
  whatsappCountryCode: string
  whatsapp:            string
  email:               string
}
```

Checkbox "Sama dengan nomor HP" **BUKAN bagian state yang disimpan** — murni kenyamanan UI di komponen (`ContactPicker`): saat dicentang, tiap kali `phone`/`phoneCountryCode` berubah, nilai itu disalin ke `whatsapp`/`whatsappCountryCode` (field WhatsApp jadi read-only selama checkbox aktif); saat dilepas centang, field WhatsApp lepas bebas diedit independen. Saat komponen menerima `initialValue` dari server, status awal checkbox dihitung (`whatsapp === phone && whatsappCountryCode === phoneCountryCode`) — bukan field terpisah yang perlu disimpan/dikirim balik.

**Kenapa TIDAK simpan boolean "samaDenganHp":** field turunan begini gampang basi (edit salah satu belakangan tanpa lewat checkbox, makna flag jadi bohong) — cukup bandingkan nilai aktual tiap kali butuh tahu status, sama seperti prinsip yang sudah dipakai untuk kolom cache harga di modul lain (dihitung ulang, bukan dipercaya buta).

### 3.3 Validator (`lib/validators/contact.ts`, BARU)

```ts
export const contactSchema = z.object({
  phoneCountryCode:    z.string().length(2).nullish(),
  phone:               z.string().min(1).nullish(),
  whatsappCountryCode: z.string().length(2).nullish(),
  whatsapp:            z.string().min(1).nullish(),
  email:               z.string().email().nullish(),
})
```
Pelajaran dari [[feedback_zod_optional_vs_nullish]] (bug yang baru saja ditemukan & ditutup di komponen Alamat): karena `ContactPicker` adalah form terkontrol yang state-nya selalu terisi (field kosong = `''`/`null`, bukan `undefined`), field opsional di sini LANGSUNG pakai `.nullish()` sejak awal — tidak menunggu bug yang sama terulang.

Validasi format nomor per-negara **TIDAK dibuat rumit** (tidak reimplementasi libphonenumber) — cukup cek non-kosong + digit, panjang wajar (7-15 digit). Validasi ketat per-negara bukan kebutuhan bisnis saat ini (beda dari validasi hierarki wilayah Alamat yang memang krusial buat kualitas data resmi).

### 3.4 Fungsi normalisasi (`lib/utils/phone.ts`, DIROMBAK jadi country-aware)

```ts
// Gabungkan kode negara + nomor lokal jadi digit E.164 tanpa "+", buat dikirim
// ke gateway WhatsApp (GOWA) atau disimpan sebagai representasi penuh.
export function toE164Digits(dialCode: string, localNumber: string): string {
  const local = localNumber.replace(/\D/g, '').replace(/^0+/, '')
  return dialCode.replace(/\D/g, '') + local
}
```
`normalizePhone()` versi lama (hardcode `62`) **dihapus, diganti** fungsi ini — dipanggil dengan `dialCode` dari `phoneCountryCode`/`whatsappCountryCode` terpilih, bukan diasumsikan Indonesia. `lib/whatsapp/client.ts`'s `normalizePhone()` (duplikat, juga hardcode) **tetap dipertahankan apa adanya** — begitu upstream selalu mengirim digit E.164 penuh tanpa `+`/`0` di depan, fungsi itu jadi no-op aman (tidak match awalan `0`/`+`) untuk semua negara, jadi tidak perlu disentuh untuk fase ini.

### 3.5 Komponen frontend (`components/shared/ContactPicker.tsx`, BARU)

Meniru pola `AddressPicker`: controlled component, `value: ContactValue`, `onChange: (v: ContactValue) => void`. Struktur:
- Baris "Nomor HP": `AutocompleteSelect` kode negara (options dari `COUNTRIES`, label `🇮🇩 +62`, filter lokal karena cuma 195 opsi — sama seperti kombobox Provinsi, bukan mode `onSearch`) + `<Input type="tel">` nomor.
- Checkbox "Sama dengan nomor HP" (default **tercentang**, sesuai gambar acuan).
- Baris "Nomor WhatsApp": kode negara + nomor, `disabled` mengikuti nilai HP selama checkbox tercentang.
- Baris "Email": `<Input type="email">`, tidak ada logic khusus di komponen ini — prefill (kalau ada) jadi tanggung jawab pemanggil (pola sama seperti Manifest §4 "boleh diprefill dari data akun").

Styling: token shadcn standar (sama keputusan seperti `AddressPicker` — reusable lintas admin/pilgrim, bukan token khusus admin).

## 4. Skema Prisma (rencana) — hanya `BookingPilgrim`, lihat §6 kenapa `User` tidak disentuh

```prisma
model BookingPilgrim {
  // ...kolom existing tidak berubah...
  phone               String?   // SUDAH ADA — makna dipertegas: nomor LOKAL, bukan penuh
  phoneCountryCode    String?   @default("ID")   // BARU
  whatsapp            String?                    // BARU
  whatsappCountryCode String?   @default("ID")   // BARU
  email               String?   // SUDAH ADA, tidak berubah
}
```
Migrasi murni additive (3 kolom baru + default), tidak ada data existing yang perlu di-backfill secara berarti — data jamaah yang ada saat ini adalah data uji coba sesi pengembangan, bukan data produksi.

## 5. Wiring ke Form Nyata — target & alasan

| Kandidat | Keputusan | Alasan |
|---|---|---|
| **`BookingPilgrim` — wizard `bookings/new/pilgrims`** | **YA, target utama** | Konteks paling pas: satu akun bisa booking untuk banyak orang (keputusan besar sesi sebelumnya), tiap jamaah butuh kontak sendiri yang independen dari akun pemesan, dan UI acuan (checkbox sync) paling natural muncul di sini. Jamaah #1 (Pemesan) di-prefill email dari `session.user.email` — sesuai permintaan user ("kalau daftar pakai email, otomatis terisi") dan konsisten dengan pola prefill yang sudah direncanakan di `docs/arsitektur-manifest.md` §4. |
| `User` — registrasi (`RegisterForm.tsx`) | **TIDAK disentuh** | Registrasi cuma butuh SATU nomor WA-aktif untuk OTP — itu identitas akun, bukan "data kontak" biasa. Menambah kode-negara-autocomplete pada satu field ini masih masuk akal, tapi menambah 2 field (HP+WA terpisah) di titik pendaftaran menambah friksi tanpa kebutuhan bisnis yang diminta. |
| `User` — profil (`ProfileForm.tsx`) | **TIDAK disentuh di fase ini** | Nomor di profil = nomor WhatsApp terverifikasi OTP (identitas), bukan field bebas edit — mengganti nomor ini seharusnya lewat alur ganti-nomor+verifikasi ulang (fitur terpisah, belum diminta), bukan tinggal ganti lewat komponen Kontak generik. Menambahkan "Nomor HP" kedua yang independen dari WA di profil adalah kemungkinan valid tapi TIDAK diminta eksplisit — dicatat sebagai kandidat masa depan, bukan dieksekusi sekarang. |
| `Vendor` (`admin/system/settings`) | **TIDAK disentuh di fase ini** | Vendor sudah punya `contactInfo: String?` (teks bebas) — mengubahnya jadi kontak terstruktur adalah perubahan terpisah yang tidak diminta, dicatat sebagai kandidat masa depan. |

Prinsip yang dipakai: eksekusi hari ini fokus ke SATU target yang jelas dan diminta secara implisit paling kuat (jamaah booking), field lain yang bersentuhan dengan OTP/identitas akun sengaja tidak diutak-atik supaya tidak menyentuh keamanan alur auth yang sudah berjalan.

## 6. Kenapa `User` Tidak Diberi Kolom Baru

`User.phone` + `phoneVerifiedAt` ITU SENDIRI sudah = "Nomor WhatsApp" secara semantik (dipakai OTP via GOWA). Menambah `whatsapp`/`phoneCountryCode` di `User` akan menciptakan ambiguitas (dua sumber kebenaran untuk "nomor WA mana yang aktif") tanpa nilai tambah, karena tidak ada kebutuhan bisnis untuk pengguna terdaftar punya 2 nomor WA berbeda antara akun vs profil. Kalau nanti dibutuhkan "Nomor HP" tambahan di profil (beda dari WA terverifikasi), itu keputusan terpisah dengan pertanyaan desain sendiri (perlu verifikasi juga? boleh beda negara?) — di luar scope yang diminta hari ini.

## 7. Dampak ke `docs/arsitektur-manifest.md` (belum dieksekusi)

§3.1 `docs/arsitektur-manifest.md` (baris 83) mendefinisikan `fieldType='phone'` sebagai "format Indonesia (+62/08xx)" — **superseded** oleh komponen ini. Saat Manifest dieksekusi nanti, `fieldType='phone'` harus dirender pakai `ContactPicker` (atau sub-bagiannya — cukup satu baris kode-negara+nomor, tanpa checkbox sync kalau cuma satu field) supaya konsisten, bukan asumsi Indonesia-only yang lama. Perlu update di dokumen itu saat dieksekusi — dicatat di sini supaya tidak terlewat, TIDAK diedit sekarang karena Manifest sendiri masih rencana (mengikuti prinsip "jangan edit dokumen rencana lain yang belum dieksekusi kecuali perlu", cukup catatan silang).

## 8. Yang TIDAK Termasuk Rencana Ini

- Validasi format nomor telepon per-negara yang ketat (libphonenumber-style) — cukup validasi longgar (digit, panjang wajar)
- Verifikasi ulang OTP kalau nomor WhatsApp jamaah (bukan akun) diganti — `BookingPilgrim.whatsapp` bukan nomor yang diverifikasi via OTP, cuma data kontak
- Perubahan ke `User`/registrasi/profil (lihat §5, §6)
- Perubahan ke `Vendor.contactInfo` (lihat §5)
- Perubahan ke `lib/whatsapp/client.ts` (normalizePhone lokalnya tetap, sudah aman untuk semua negara selama upstream kirim digit E.164 penuh — lihat §3.4)

## 9. Rencana Eksekusi (fase, ikuti Fase Eksekusi SOP)

1. **Fase 1 — Dataset & util dasar**: `dialCode` di `COUNTRIES` (SUDAH dieksekusi di atas), `lib/utils/flag.ts` (BARU), `lib/utils/phone.ts` (`toE164Digits`, ganti `normalizePhone` lama), `lib/validators/contact.ts` (BARU)
2. **Fase 2 — Schema**: `BookingPilgrim` +3 kolom, migrasi
3. **Fase 3 — Komponen frontend**: `components/shared/ContactPicker.tsx`
4. **Fase 4 — Wiring**: `lib/booking/draft.ts` (`PilgrimData` +3 field), `lib/validators/booking.ts` (pilgrims array +3 field), `app/api/v1/bookings/route.ts` (create pilgrim +3 field), `app/[locale]/(pilgrim)/bookings/new/pilgrims/page.tsx` (ganti UI manual jadi `ContactPicker`, prefill email jamaah #1 dari sesi)
5. **Fase 5 — Verifikasi & dokumentasi**: `bun run build` 0 error, uji browser end-to-end (isi 2 jamaah beda negara, cek checkbox sync, submit booking, cek DB), update `docs/progress.md`/`docs/decisions.md`

## 10. Verifikasi (2026-07-23)

Semua 5 fase di §9 dieksekusi berurutan, `bun run build` 0 error di tiap fase. Verifikasi akhir dilakukan di browser (bukan cuma baca kode) + langsung ke DB — 2 bug NYATA ditemukan dan ditutup saat proses ini, dicatat di sini karena keduanya baru muncul begitu komponen benar-benar dicoba, bukan dari inspeksi kode:

**Bug #1 — Checkbox "Sama dengan nomor HP" tidak bisa dilepas centang.** Implementasi awal §3.2 murni menghitung `sameAsPhone` dari perbandingan `phone`/`whatsapp` aktual (tanpa state independen) — begitu dilepas centang, `toggleSameAsPhone(false)` cuma memanggil `onChange(value)` dengan value yang SAMA PERSIS, jadi tidak ada perubahan apa pun dan nilai turunan `sameAsPhone` langsung balik jadi `true` lagi di render berikutnya (karena `phone`/`whatsapp` masih identik). Akibatnya field WhatsApp tidak pernah bisa benar-benar lepas dari Nomor HP lewat UI. **Fix:** tambah state lokal `unlocked` di `ContactPicker` — melepas centang men-set `unlocked=true` (mengabaikan nilai turunan sampai pengguna centang ulang secara eksplisit), bukan murni bergantung pada perbandingan nilai. Diverifikasi ulang: uncheck → field WhatsApp aktif & independen → isi nomor beda + ganti kode negara ke Arab Saudi → checkbox tetap tidak tercentang → centang ulang → WhatsApp otomatis kembali sama persis dengan Nomor HP dan terkunci lagi.

**Bug #2 — `payment/page.tsx` tidak meneruskan 3 field baru ke API.** Fase 4 mengupdate `PilgrimData`, UI wizard, validator, dan route handler booking — tapi terlewat satu titik: `app/[locale]/(pilgrim)/bookings/new/payment/page.tsx` membangun payload POST `/api/v1/bookings` secara manual dari `draft.pilgrims`, dan baris itu cuma menyalin `fullName`/`gender`/`email`/`phone` — `phoneCountryCode`/`whatsapp`/`whatsappCountryCode` tidak pernah ikut terkirim meski sudah ada di draft. Ditemukan saat mencoba submit booking sungguhan lewat wizard (bukan cuma test komponen). **Fix:** tambah 3 field itu ke payload di titik tersebut.

**Verifikasi akhir (setelah kedua fix):**
- Browser: `ContactPicker` render dengan kode negara default Indonesia, prefill email dari akun (`admin@saudinesia.local`) berhasil otomatis mengisi field Email saat wizard dibuka.
- Sinkronisasi checkbox: isi Nomor HP → WhatsApp ikut terisi sama persis (termasuk kode negara) → uncheck → field WhatsApp lepas & bisa diedit independen (dicoba ganti ke kode negara Arab Saudi + nomor beda) → checkbox tetap tidak tercentang → centang ulang → WhatsApp tersinkron balik.
- End-to-end lewat curl (menggantikan submit browser yang terganggu artefak alat automation — lihat catatan bawah): `POST /api/v1/bookings` dengan `phone="82223334445"`/`phoneCountryCode="ID"` dan `whatsapp="501234567"`/`whatsappCountryCode="SA"` (kode negara BERBEDA dari phone) → 201, `BookingPilgrim` di DB dikonfirmasi menyimpan keduanya persis sesuai kiriman — kode negara Nomor HP dan WhatsApp benar-benar independen di data, bukan cuma di UI. Data test dibersihkan setelahnya.
- Catatan: submit lewat klik tombol asli di browser pane berulang kali terganggu artefak alat automation yang sama seperti tercatat di sesi-sesi sebelumnya (navigasi tak terduga ke homepage) — bukan bug kode (dikonfirmasi karena payload/skema/route yang sama persis berhasil sempurna lewat curl). Verifikasi form-level (render, prefill, sinkronisasi checkbox) tetap dilakukan penuh di browser sebelum insiden itu terjadi.

**Pelajaran proses:** kedua bug ini luput dari `bun run build` (keduanya valid secara tipe) dan dari review kode sekilas — baru ketahuan karena benar-benar dicoba end-to-end (isi form asli, submit booking asli, cek DB asli). Menguatkan pola yang sudah tercatat di [[feedback_zod_optional_vs_nullish]]: verifikasi "kelihatan benar di kode" tidak cukup untuk komponen form interaktif, terutama yang punya derived state (checkbox dari perbandingan value) atau titik integrasi berlapis (draft → payload → validator → DB).

## 11. Referensi Silang

- Pola desain & keputusan gaya: `docs/arsitektur-alamat.md` (komponen berdiri sendiri dulu → diwire, `.nullish()` di validator, styling shadcn generik)
- Prasyarat/pasangan: `docs/arsitektur-manifest.md` §3.1 (perlu update saat dieksekusi, lihat §7 di atas)
- Booking multi-jamaah: keputusan besar "satu akun bisa booking untuk banyak orang" (diskusi sesi 2026-07-23, sebelum eksekusi Alamat)

> **Pembaruan 2026-10-30:** emoji bendera (`isoToFlagEmoji`, `lib/utils/flag.ts`) dihapus — Windows tidak menggambarnya (tampil dua huruf). Bendera kini gambar SVG statis `public/flags/<ISO>.svg` lewat komponen `Flag`; lihat `docs/arsitektur-combobox.md` §4d.
