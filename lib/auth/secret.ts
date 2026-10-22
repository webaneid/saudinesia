// JWT_SECRET harus kuat: dengannya sesi superadmin bisa dipalsukan. Ditegakkan saat dipakai (fail-closed), bukan hanya "tidak kosong".

// Awalan nilai contoh (`replace_with_64_char_random_hex` di .env.example, dst.) — ditolak berapa pun panjangnya setelah diisi/diperpanjang.
const PLACEHOLDER_PREFIX = /^(replace|change[_-]?me|your[_-]|example|placeholder|secret$|jwt[_-]?secret$)/i
export const MIN_JWT_SECRET_LENGTH = 32
const MIN_DISTINCT_CHARS = 8 // rahasia acak (hex/base64) punya ≥8 karakter berbeda; 'aaaa…' / '1234123412…' tidak

export function jwtSecretProblem(secret: string | undefined): string | null {
  if (!secret) return 'JWT_SECRET is not set'
  if (secret.length < MIN_JWT_SECRET_LENGTH) return `JWT_SECRET terlalu pendek (minimal ${MIN_JWT_SECRET_LENGTH} karakter) — buat dengan: openssl rand -hex 32`
  if (PLACEHOLDER_PREFIX.test(secret.trim())) return 'JWT_SECRET masih berisi nilai contoh — buat dengan: openssl rand -hex 32'
  if (new Set(secret).size < MIN_DISTINCT_CHARS) return 'JWT_SECRET entropi terlalu rendah (karakter terlalu sedikit yang berbeda) — buat dengan: openssl rand -hex 32'
  return null
}

/** Rahasia JWT yang sudah divalidasi; melempar bila kosong/lemah/placeholder. */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  const problem = jwtSecretProblem(secret)
  if (problem) throw new Error(problem)
  return secret as string
}
