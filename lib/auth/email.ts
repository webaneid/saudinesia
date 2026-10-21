/** Email dinormalisasi huruf kecil di SEMUA jalur auth (daftar, login, lupa password, Google) — docs/arsitektur-auth.md §3.1. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}
