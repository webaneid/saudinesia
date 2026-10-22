// Atribut cookie auth — satu tempat, dapat diuji (session.ts bergantung pada next/headers sehingga tak bisa diimpor skrip uji).

/**
 * Cookie sesi memakai SameSite=LAX, bukan Strict. Strict TIDAK dikirim pada navigasi yang rantai redirect-nya diawali dari situs lain: callback
 * Google (accounts.google.com → /api/v1/auth/google/callback → 302 → /dashboard) menjadi mendarat di halaman login padahal sesi SUDAH dibuat
 * (direproduksi 2026-10-22 dengan Google palsu di situs berbeda), dan tautan di email notifikasi (klik dari Gmail/webmail) tampak "logout".
 * Lax tetap tidak dikirim pada POST/PUT/DELETE lintas-situs — semua operasi yang mengubah data di aplikasi ini bukan GET (CSRF tetap tertutup).
 * Keputusan: docs/decisions.md 2026-10-22 (mengubah aturan SameSite=Strict di CLAUDE.md § Security).
 */
export const SESSION_SAME_SITE = 'lax' as const

/** `Secure` aktif di SEMUA lingkungan kecuali development persis (fail-closed, SEC-02) — NODE_ENV salah/kosong tidak boleh melepas Secure. */
export function cookieSecure(): boolean {
  return process.env.NODE_ENV !== 'development'
}
