# Admin Dashboard Redesign — Unified Panel

**Status:** Planning  
**Trigger:** Dua dashboard terpisah (`/admin` dan `/superadmin`) tidak user-friendly dan tidak scalable untuk tim.

---

## Masalah Saat Ini

| Masalah | Dampak |
|---------|--------|
| `/admin` dan `/superadmin` adalah URL terpisah | Staff bingung harus masuk ke mana |
| Manajemen produk hanya bisa superadmin | Bottleneck — satu orang pegang semua |
| Tidak ada role "manager" | Tidak bisa delegasi ke tim produk |
| Login redirect beda per role | UX tidak konsisten |

---

## Solusi: Satu Dashboard, Role-Based Menu

**URL tunggal:** `/[locale]/admin`  
**Sidebar:** section tampil/sembunyi berdasarkan role user yang login.

```
/admin
├── OPERASIONAL          → admin, manager, superadmin
│   ├── Overview
│   ├── Booking
│   ├── Pembayaran
│   ├── Visa (status jamaah)
│   ├── Quota
│   └── Notifikasi
│
├── MANAJEMEN PRODUK     → manager, superadmin
│   ├── Paket & Bundle
│   ├── Haji
│   ├── Visa Produk
│   ├── Hotel
│   ├── Transport
│   ├── Muthowif
│   ├── Katering
│   └── Ziarah & Musim
│
└── SISTEM               → superadmin only
    ├── Pengguna & Akses
    └── Pengaturan (bank account, QRIS, dsb)
```

---

## Struktur Role Baru

| Role | Deskripsi | Akses |
|------|-----------|-------|
| `pilgrim` | Jamaah / client | Public front-end saja |
| `agent` | Agen perjalanan | Public front-end + group booking |
| `admin` | Staff operasional | Seksi OPERASIONAL saja |
| `manager` | Manajer produk | OPERASIONAL + MANAJEMEN PRODUK |
| `superadmin` | Pemilik / direktur | Semua seksi termasuk SISTEM |

---

## Perubahan yang Diperlukan

### 1. Database — Prisma Schema

Tambah `manager` ke enum `UserRole`:

```prisma
enum UserRole {
  pilgrim
  agent
  admin
  manager    // ← BARU
  superadmin
}
```

Migration: `add_manager_role`

---

### 2. Middleware — Auth Guard

```typescript
// lib/auth/session.ts
export async function requireAdmin(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!['admin', 'manager', 'superadmin'].includes(session.role)) throw new Error('Forbidden')
  return session
}

export async function requireManager(): Promise<SessionPayload> {
  const session = await requireSession()
  if (!['manager', 'superadmin'].includes(session.role)) throw new Error('Forbidden')
  return session
}

// requireSuperAdmin() sudah ada, tidak berubah
```

---

### 3. Routing / URL Structure

| Sebelum | Sesudah |
|---------|---------|
| `/admin` → ops panel | `/admin` → unified panel (semua role) |
| `/superadmin` → product panel | `/admin/products/hotels` dll (dalam satu panel) |
| `/admin/login` | `/admin/login` (tidak berubah) |

**URL produk baru di bawah `/admin`:**

```
/admin/products/packages
/admin/products/haji
/admin/products/visa
/admin/products/hotels
/admin/products/transport
/admin/products/muthowif
/admin/products/catering
/admin/products/tours
/admin/products/seasons
/admin/system/users
/admin/system/settings
```

---

### 4. Admin Layout — Unified Sidebar

Satu layout file: `app/[locale]/admin/layout.tsx`  
Sidebar sections conditional berdasarkan `session.role`:

```typescript
const OPERATIONAL_NAV = [...] // tampil untuk semua admin
const PRODUCT_NAV = [...]     // tampil untuk manager + superadmin
const SYSTEM_NAV = [...]      // tampil untuk superadmin only

const MANAGER_ROLES = ['manager', 'superadmin']
const SUPERADMIN_ROLES = ['superadmin']
```

---

### 5. API Route Guards

| Endpoint | Guard sekarang | Guard baru |
|----------|---------------|------------|
| `GET /admin/bookings` | `requireAdmin()` | `requireAdmin()` (tidak berubah) |
| `POST /admin/payments/confirm` | `requireAdmin()` | `requireAdmin()` |
| Semua `/superadmin/*` | `requireSuperAdmin()` | **Dipindah ke** `/admin/products/*` dengan `requireManager()` |
| User management | `requireSuperAdmin()` | `requireSuperAdmin()` (tidak berubah) |

---

### 6. Halaman yang Perlu Dibuat / Dipindah

| Halaman lama | Halaman baru | Notes |
|--------------|--------------|-------|
| `/superadmin` (overview) | Merger ke `/admin` overview | Tambah section produk di overview |
| `/superadmin/hotels` | `/admin/products/hotels` | Pindah + guard ganti ke `requireManager()` |
| `/superadmin/transport` | `/admin/products/transport` | Idem |
| `/superadmin/muthowif` | `/admin/products/muthowif` | Idem |
| `/superadmin/haji` | `/admin/products/haji` | Idem |
| `/superadmin/visa` | `/admin/products/visa` | Idem |
| `/superadmin/packages` | `/admin/products/packages` | Idem |
| `/superadmin/catering` | `/admin/products/catering` | Idem |
| `/superadmin/tours` | `/admin/products/tours` | Idem |
| `/superadmin/seasons` | `/admin/products/seasons` | Idem |
| `/superadmin/users` | `/admin/system/users` | Guard tetap `requireSuperAdmin()` |
| — | `/admin/system/settings` | Baru — bank account, QRIS, business config |

---

### 7. Login & Redirect Logic

Semua admin login di `/admin/login`.  
Setelah login, semua role redirect ke `/admin` (satu URL).  
Sidebar yang berbeda secara otomatis menunjukkan menu yang relevan.

```
admin      → /admin (lihat operasional saja)
manager    → /admin (lihat operasional + produk)
superadmin → /admin (lihat semua)
```

---

### 8. Halaman yang Dihapus

- Seluruh direktori `app/[locale]/superadmin/` → dipindah ke dalam `/admin/`
- URL `/superadmin/*` tidak lagi ada

Redirect lama ke baru untuk antisipasi bookmark:
```typescript
// middleware.ts — redirect /superadmin/* ke /admin/products/*
```

---

## Urutan Eksekusi

1. **Prisma migration** — tambah `manager` ke enum `UserRole`
2. **Update `lib/auth/session.ts`** — tambah `requireManager()`
3. **Buat folder `/admin/products/` dan `/admin/system/`** — pindah semua halaman superadmin
4. **Rebuild admin layout** — unified sidebar dengan section conditional
5. **Update semua API route guards** — `/superadmin/*` → `/admin/products/*` dengan `requireManager()`
6. **Update admin overview** — gabungkan stat operasional + produk
7. **Update redirect** — login selalu ke `/admin`, superadmin path → produk path
8. **Hapus `/superadmin/*`** — hapus setelah semua dipindah
9. **Update seed script** — tambah user dengan role `manager` sebagai contoh
10. **Build check** → dokumentasi → update progress.md

---

## Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| URL lama di-bookmark staff | Tambah redirect dari `/superadmin/*` ke `/admin/*` |
| API route masih pakai guard lama | Audit semua route setelah pindah, grep `requireSuperAdmin` |
| Session payload tidak punya `manager` role | Update `SessionPayload` type di `session.ts` |

---

## Yang TIDAK Berubah

- Login URL: `/admin/login` tetap sama
- Public front-end: tidak ada perubahan
- Pilgrim dashboard: `/dashboard` tetap sama
- Auth flow (OTP, email+password): tidak berubah
- DB schema kecuali tambah `manager` enum
