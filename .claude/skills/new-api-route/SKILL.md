---
name: new-api-route
description: Scaffold Route Handler baru di app/api/v1 mengikuti konvensi project (Next.js Route Handler + Zod validator + Prisma, response format {success, data?, error?, meta?}). Gunakan saat user minta "tambah endpoint baru" atau "buat route untuk resource X".
---

# Skill: New API Route

> Diadopsi dari template `master-typescript` (2026-09-10), disesuaikan ke
> konvensi asli project ini (`CLAUDE.md` § API Conventions) — Next.js Route
> Handler, bukan Elysia.

Ketika diminta bikin endpoint/route baru:

1. Baca `CLAUDE.md` § API Conventions dan § Prisma untuk pola response
   format & aturan validasi yang berlaku.
2. Buat file `app/api/v1/{resource}/route.ts` (atau `[id]/route.ts` untuk
   resource by-id) — pakai HTTP method export (`GET`/`POST`/`PATCH`/`DELETE`)
   sesuai konvensi Next.js Route Handler.
3. Validasi SEMUA input (body/query/params) dengan Zod schema di
   `lib/validators/` sebelum menyentuh Prisma — infer type TS dari schema
   (`type X = z.infer<typeof XSchema>`), jangan duplikasi definisi type.
4. Panggil `lib/auth/session.ts` di awal handler untuk route protected —
   `middleware.ts` saja TIDAK cukup (aturan eksplisit `CLAUDE.md`).
5. Response selalu `{ success: boolean, data?: T, error?: string, meta?: Record<string, unknown> }`
   dengan status code sesuai konvensi (200/201/400/401/403/404/409/422/500) —
   jangan return raw object atau Prisma error mentah.
6. Kalau butuh tabel/kolom baru, ikuti alur Prisma yang sudah ada: edit
   `prisma/schema.prisma` → `bun prisma migrate dev --name <deskriptif>` →
   review migration file → jangan pernah `prisma db push` di production.
7. Kalau logic query-nya nontrivial atau dipakai lebih dari satu route,
   pertimbangkan taruh di helper terpisah di `lib/` (pola yang sudah ada,
   mis. `lib/quota/`, `lib/booking/`) — jangan tumpuk semua logic langsung
   di handler kalau sudah lebih dari beberapa langkah.
8. Sebelum dianggap selesai, jalankan skill `security-review` untuk file
   route yang baru dibuat (checklist lengkap di
   `docs/architecture/architecture-security.md`).
9. Kalau ada perilaku yang perlu diingat untuk endpoint ini (edge case dsb),
   catat di `docs/decisions.md` mengikuti format entri yang sudah ada
   (`## YYYY-MM-DD — <title>` / Decision / Rationale / Alternatives).
