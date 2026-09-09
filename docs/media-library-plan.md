# Media Library — Perencanaan Implementasi

> Dibuat: 2026-05-21  
> Status: DRAFT — belum diimplementasi  
> Terkait: M7 (Visa Documentation Module), M5 (Pilgrim Dashboard)

---

## 1. Ringkasan

Komponen Media Library terdiri dari dua surface berbeda:

| Surface | Siapa | Aksi |
|---------|-------|------|
| **Pilgrim** | Jamaah login | Upload, preview, hapus dokumen milik sendiri |
| **Admin** | Staff admin/manager | Preview semua dokumen jamaah, download ZIP, hapus jika perlu |

Kedua surface menggunakan **modal/popup** sebagai entry point upload — bukan inline form — supaya tidak memecah halaman dan bisa dipanggil dari mana saja.

---

## 2. Jenis Dokumen

Dari `lib/constants/booking.ts`:

```ts
REQUIRED_DOCUMENTS = ['passport', 'ktp', 'kk', 'evaksin', 'etiket']
```

| `docType` | Label | Keterangan |
|-----------|-------|------------|
| `passport` | Paspor (scan) | Wajib, berlaku min 7 bulan |
| `ktp` | KTP / NIK | Wajib |
| `kk` | Kartu Keluarga | Wajib |
| `evaksin` | Sertifikat Vaksin | Wajib |
| `etiket` | E-Tiket Pesawat PP | Wajib (jika sudah ada) |

Format yang diterima: **JPG, PNG, PDF** — maks **5 MB** per file.  
Satu jamaah = satu file per `docType`. Upload baru akan menggantikan yang lama.

---

## 3. Arsitektur Komponen

```
components/
  shared/
    media/
      UploadModal.tsx         ← Modal utama dengan drag-drop zone
      DocumentGrid.tsx        ← Grid kartu dokumen per jamaah
      DocumentCard.tsx        ← Satu kartu: status, preview thumbnail, aksi
      PreviewModal.tsx        ← Modal preview fullscreen (image/PDF embed)
      useDocuments.ts         ← Custom hook: fetch list, upload, delete, preview URL

  admin/
    PilgrimDocuments.tsx      ← Admin view (readonly + ZIP download)
```

### Hierarki render (Pilgrim)

```
BookingDetailPage (Server Component)
  └─ DocumentGrid (Client Component)
       ├─ DocumentCard × 5  (per docType)
       │    ├─ [jika belum upload] → tombol "Upload" → buka UploadModal
       │    └─ [jika sudah upload] → thumbnail + tombol View / Hapus
       ├─ UploadModal (conditional render, satu instance)
       └─ PreviewModal (conditional render, satu instance)
```

### Hierarki render (Admin)

```
AdminBookingDetailPage (Server Component)
  └─ PilgrimDocuments (Client Component)
       ├─ DocumentCard (readonly) × n
       ├─ PreviewModal
       └─ tombol "Download ZIP"
```

---

## 4. State Machine Upload

```
IDLE
  │
  ▼ (klik "Upload" di DocumentCard)
MODAL_OPEN           ← docType sudah diketahui
  │
  ▼ (user pilih / drag file)
FILE_SELECTED        ← state: { file: File, preview: string | null }
  │
  ▼ (validasi client-side: MIME + size)
  ├─ GAGAL → tampil error inline, kembali ke FILE_SELECTED
  └─ LULUS ↓
  ▼ (klik "Upload")
UPLOADING            ← tampilkan progress bar (XHR dengan onprogress)
  │
  ├─ GAGAL → tampil error, kembali ke FILE_SELECTED (bisa retry)
  └─ SUKSES ↓
  ▼
UPLOAD_DONE          ← modal tutup, DocumentGrid refresh via revalidate
IDLE
```

---

## 5. API Contract

### 5.1 List dokumen jamaah
```
GET /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents
Auth: pilgrim session (hanya milik sendiri) ATAU admin session
```

**Response 200:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "docType": "passport",
      "fileName": "scan-paspor.jpg",
      "fileSizeBytes": 1240000,
      "uploadedAt": "2026-05-21T10:00:00Z",
      "hasFile": true
    }
  ]
}
```

---

### 5.2 Upload dokumen
```
POST /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents
Auth: pilgrim session (hanya milik sendiri)
Content-Type: multipart/form-data
```

**Body (FormData):**
```
file     : File  (JPG / PNG / PDF, maks 5 MB)
docType  : string ("passport" | "ktp" | "kk" | "evaksin" | "etiket")
```

**Validasi server-side (wajib, tidak boleh skip meski sudah ada validasi client):**
- Session valid + booking milik user
- `docType` harus ada di `REQUIRED_DOCUMENTS`
- MIME type: hanya `image/jpeg`, `image/png`, `application/pdf`
- Size: ≤ 5 MB

**Flow internal:**
1. Jika sudah ada dokumen dengan `docType` yang sama → hapus object lama dari MinIO dulu
2. Upload buffer ke MinIO: key = `pilgrims/{pilgrimId}/{docType}/{timestampMs}-{safeName}`
3. Upsert record `Document` di DB (hapus lama jika ada, buat baru)
4. Return metadata dokumen baru

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "docType": "passport",
    "fileName": "scan-paspor.jpg",
    "fileSizeBytes": 1240000,
    "uploadedAt": "2026-05-21T10:00:00Z"
  }
}
```

**Error responses:**
- `400` — docType invalid atau file tidak ada
- `400` — MIME tidak diizinkan (pesan: "Gunakan JPG, PNG, atau PDF")
- `400` — File terlalu besar (pesan: "Ukuran maksimal 5 MB")
- `403` — Booking bukan milik user ini

---

### 5.3 Preview — generate presigned URL
```
GET /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/[docId]/preview
Auth: pilgrim session (milik sendiri) ATAU admin session
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "url": "https://minio.../presigned-url...",
    "expiresIn": 900
  }
}
```

Presigned URL TTL: **15 menit** (900 detik) untuk pilgrim.  
Admin bisa mendapat TTL **60 menit** (3600 detik) untuk download / cetak.

---

### 5.4 Hapus dokumen
```
DELETE /api/v1/pilgrims/[bookingId]/[pilgrimId]/documents/[docId]
Auth: pilgrim session (milik sendiri) ATAU admin session
```

**Flow internal:**
1. Ambil `filePath` dari DB
2. Hapus object dari MinIO via `client.removeObject(BUCKET, filePath)`
3. Hapus record `Document` dari DB

**Response 200:**
```json
{ "success": true, "data": null }
```

---

### 5.5 Download ZIP (admin only)
```
GET /api/v1/admin/bookings/[id]/documents/zip
Auth: admin session
```

**Flow internal:**
1. Ambil semua `Document` untuk semua pilgrim di booking ini
2. Unduh setiap object dari MinIO sebagai buffer
3. Buat ZIP di memory (pakai library `jszip`)
4. Stream ZIP ke client sebagai `application/zip`

**Response:** binary stream  
**Headers:**  
```
Content-Type: application/zip
Content-Disposition: attachment; filename="docs-{bookingCode}.zip"
```

---

## 6. Struktur File Lengkap

```
# Komponen baru
components/shared/media/
  UploadModal.tsx
  DocumentGrid.tsx
  DocumentCard.tsx
  PreviewModal.tsx
  useDocuments.ts

components/admin/
  PilgrimDocuments.tsx         ← update dari PassportForm yang ada

# API routes (isi skeleton yang sudah ada + tambah baru)
app/api/v1/pilgrims/[bookingId]/[pilgrimId]/
  documents/route.ts           ← GET (list) + POST (upload) — IMPLEMENT
  documents/[docId]/route.ts   ← GET (preview URL) + DELETE — BARU

app/api/v1/admin/bookings/[id]/
  documents/zip/route.ts       ← GET (ZIP download) — IMPLEMENT

# MinIO client (tambah fungsi)
lib/storage/minio.ts           ← tambah deleteObject()

# Halaman yang diupdate
app/[locale]/(pilgrim)/bookings/[id]/page.tsx    ← tambah <DocumentGrid>
app/[locale]/admin/(protected)/bookings/[id]/page.tsx  ← tambah <PilgrimDocuments>

# Dependency baru
jszip                          ← untuk ZIP download (bun add jszip)
```

---

## 7. Desain UI — UploadModal

```
┌─────────────────────────────────────────────────────────┐
│  Upload Dokumen                               [×]        │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Jenis Dokumen                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │  📄  Paspor (scan)                    [▼]        │   │
│  └──────────────────────────────────────────────────┘   │
│  (pre-selected jika dibuka dari DocumentCard tertentu)   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                                                  │   │
│  │       ↑  Seret file ke sini                      │   │
│  │          atau                                    │   │
│  │       [ Pilih File ]                             │   │
│  │                                                  │   │
│  │  JPG, PNG, atau PDF · Maks 5 MB                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ─── (setelah file dipilih) ───────────────────────────  │
│                                                          │
│  ┌──────────────┐  scan-paspor.jpg                       │
│  │  [preview]   │  1.2 MB · image/jpeg                   │
│  │  thumbnail   │  ✓ Format dan ukuran OK                │
│  └──────────────┘                                        │
│                                                          │
│  [============================--------]  68%             │
│                                                          │
│            [ Batal ]    [ Upload ]                       │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Desain UI — DocumentCard

**State: Belum upload**
```
┌────────────────────────────────────┐
│  📄  Paspor (scan)                 │
│                                    │
│  ○  Belum diupload                 │
│                                    │
│              [ Upload ]            │
└────────────────────────────────────┘
```

**State: Sudah upload**
```
┌────────────────────────────────────┐
│  ✓  Paspor (scan)           [···]  │
│                                    │
│  ┌──────┐  scan-paspor.jpg         │
│  │ img  │  1.2 MB                  │
│  │      │  21 Mei 2026             │
│  └──────┘                          │
│                                    │
│    [ Lihat ]   [ Ganti ]           │
└────────────────────────────────────┘
```

---

## 9. DocumentGrid Layout (Pilgrim)

```
┌──────────────────────────────────────────────────────────┐
│  Dokumen Perjalanan                                       │
│  3 dari 5 dokumen telah diupload                         │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  ✓ Paspor│  │  ✓ KTP   │  │  ○ KK    │               │
│  │  [thumb] │  │  [thumb] │  │  Upload  │               │
│  └──────────┘  └──────────┘  └──────────┘               │
│  ┌──────────┐  ┌──────────┐                              │
│  │  ✓ Vaksin│  │  ○ E-Tiket│                             │
│  │  [thumb] │  │  Upload  │                              │
│  └──────────┘  └──────────┘                              │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Admin — PilgrimDocuments

Ditampilkan di dalam accordion / collapsible per jamaah di halaman booking detail admin.

```
┌──────────────────────────────────────────────────────────┐
│  Budi Santoso  [▼]                   [ Download ZIP ]    │
│  ────────────────────────────────────────────────────    │
│                                                          │
│  Paspor ✓   KTP ✓   KK ○   Vaksin ✓   E-Tiket ○         │
│                                                          │
│  [Paspor] [KTP] [Vaksin]  ← klik → buka PreviewModal    │
└──────────────────────────────────────────────────────────┘
```

---

## 11. Urutan Implementasi

| # | Task | File |
|---|------|------|
| 1 | Tambah `deleteObject()` ke MinIO client | `lib/storage/minio.ts` |
| 2 | Implementasi GET + POST `/documents` | `app/api/v1/pilgrims/.../documents/route.ts` |
| 3 | Buat route `/documents/[docId]` (preview + delete) | `app/api/v1/pilgrims/.../documents/[docId]/route.ts` |
| 4 | Implementasi ZIP download (admin) | `app/api/v1/admin/bookings/[id]/documents/zip/route.ts` |
| 5 | `useDocuments` hook | `components/shared/media/useDocuments.ts` |
| 6 | `DocumentCard` | `components/shared/media/DocumentCard.tsx` |
| 7 | `UploadModal` (drag-drop + progress) | `components/shared/media/UploadModal.tsx` |
| 8 | `PreviewModal` | `components/shared/media/PreviewModal.tsx` |
| 9 | `DocumentGrid` (orchestrator) | `components/shared/media/DocumentGrid.tsx` |
| 10 | `PilgrimDocuments` (admin readonly) | `components/admin/PilgrimDocuments.tsx` |
| 11 | Pasang ke pilgrim booking detail | `app/[locale]/(pilgrim)/bookings/[id]/page.tsx` |
| 12 | Pasang ke admin booking detail | `app/[locale]/admin/(protected)/bookings/[id]/page.tsx` |
| 13 | `bun add jszip @types/jszip` | — |
| 14 | `bun run build` — zero error | — |

---

## 12. Keputusan Arsitektur

### Upload lewat server (bukan direct-to-MinIO)
Pilgrim upload file → Next.js server → MinIO, bukan langsung ke MinIO dari browser.  
**Alasan:** validasi MIME + size harus dilakukan server-side (tidak bisa dipercaya dari client). MinIO bucket bersifat private, tidak ada direct upload URL tanpa pre-signing khusus (yang membuka celah bypass validasi).

### Satu file per docType
Upload baru menggantikan (replace) dokumen lama untuk `docType` yang sama.  
**Alasan:** simplifikasi — tidak perlu versioning, tidak membuang kuota MinIO dengan file orphan.

### Presigned URL (bukan proxy stream)
Preview dokumen menggunakan presigned URL yang di-generate server, bukan meng-stream file melalui Next.js.  
**Alasan:** file besar (PDF, scan HQ) tidak membebani server Next.js. Browser fetch langsung ke MinIO, lebih cepat dan ringan.

### State manajemen: local component state (bukan Zustand)
`useDocuments` hook menggunakan `useState` + `useEffect` lokal, bukan global store.  
**Alasan:** dokumen per-jamaah bersifat isolated — tidak ada shared state antar komponen. Zustand tidak diperlukan.

### Popup/modal bukan inline
Upload dan preview menggunakan modal, bukan inline dalam card.  
**Alasan:** halaman detail booking sudah padat. Modal menjaga layout bersih dan fokus pengguna ke satu task.

---

## 13. Dependensi Baru

| Package | Versi | Kegunaan |
|---------|-------|---------|
| `jszip` | latest | Generate ZIP buffer di memory untuk admin download |
| `@types/jszip` | latest | TypeScript types |

Tidak ada UI library baru — komponen menggunakan shadcn/ui primitives (`Dialog`, `Progress`) yang sudah ada.

---

## 14. Validasi & Error Handling

| Kondisi | Layer | Pesan ke User |
|---------|-------|---------------|
| File type tidak valid | Client + Server | "Gunakan format JPG, PNG, atau PDF" |
| File > 5 MB | Client + Server | "Ukuran file maksimal 5 MB" |
| MinIO tidak bisa dijangkau | Server | "Gagal menyimpan file. Coba lagi." |
| Booking bukan milik user | Server | 403 — tidak expose detail |
| File sudah ada (replace) | Server | Proses otomatis, tidak perlu konfirmasi user |
| Hapus gagal di MinIO | Server | Log error, tetap hapus dari DB (eventual consistency) |

---

*Dokumen ini menjadi acuan implementasi. Update jika ada keputusan yang berubah selama coding.*
