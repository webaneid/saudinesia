/**
 * Normalize any Indonesian phone input to E.164 without the leading +.
 * Examples:
 *   "8111222333"   → "628111222333"
 *   "08111222333"  → "628111222333"
 *   "+628111222333"→ "628111222333"
 *   "628111222333" → "628111222333"
 *
 * Dipakai KHUSUS oleh alur registrasi/OTP (docs/arsitektur-komponen-kontak.md §5 — nomor WA
 * akun sengaja tetap Indonesia-only, bukan bagian dari komponen Kontak generik).
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-+]/g, '')
  if (digits.startsWith('62')) return digits
  if (digits.startsWith('0')) return '62' + digits.slice(1)
  return '62' + digits
}

/**
 * Gabungkan kode negara (dial code, tanpa "+") + nomor lokal jadi digit E.164 penuh —
 * dipakai komponen Kontak (docs/arsitektur-komponen-kontak.md §3.4) yang sadar negara,
 * beda dari normalizePhone() di atas yang hardcode Indonesia.
 */
export function toE164Digits(dialCode: string, localNumber: string): string {
  const local = localNumber.replace(/\D/g, '').replace(/^0+/, '')
  const dial = dialCode.replace(/\D/g, '')
  return dial + local
}
