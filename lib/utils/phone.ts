import { COUNTRIES } from '@/lib/constants/countries'

/**
 * Normalize any Indonesian phone input to E.164 without the leading +.
 * Examples:
 *   "8111222333"   → "628111222333"
 *   "08111222333"  → "628111222333"
 *   "+628111222333"→ "628111222333"
 *   "628111222333" → "628111222333"
 *
 * Hanya untuk input nomor Indonesia (mis. skrip/tes). Form akun memakai kode negara dari komponen Kontak → `e164FromCountry`.
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

/**
 * Nomor akun (telepon/WhatsApp) disimpan sebagai digit E.164 tanpa "+" (docs/arsitektur-auth.md §3.1). Menyusunnya dari kode
 * negara ISO (mis. 'ID') + nomor lokal yang diketik; mengembalikan '' bila negara tidak dikenal atau nomor kosong.
 */
export function e164FromCountry(countryCode: string, localNumber: string): string {
  const country = COUNTRIES.find((c) => c.code === countryCode)
  const local = localNumber.replace(/\D/g, '')
  if (!country || !local) return ''
  return toE164Digits(country.dialCode, local)
}

/** Samarkan nomor untuk ditampilkan di email (+62••••••890): pemilik nomor mengenalinya, orang lain tidak bisa membacanya utuh. */
export function maskE164(digits: string): string {
  if (digits.length <= 6) return '+' + '•'.repeat(digits.length)
  return `+${digits.slice(0, 2)}${'•'.repeat(digits.length - 5)}${digits.slice(-3)}`
}

/**
 * Kebalikan e164FromCountry: pecah digit E.164 tersimpan jadi kode negara ISO + nomor lokal untuk mengisi ulang komponen Kontak.
 * Kode panggilan dicocokkan dari yang TERPANJANG (mis. '1268' Antigua sebelum '1' AS). Tidak dikenal → Indonesia dengan angka apa adanya.
 */
export function splitE164(digits: string): { countryCode: string; local: string } {
  const clean = digits.replace(/\D/g, '')
  let best: (typeof COUNTRIES)[number] | undefined
  for (const c of COUNTRIES) {
    if (clean.startsWith(c.dialCode) && clean.length > c.dialCode.length && (!best || c.dialCode.length > best.dialCode.length)) best = c
  }
  return best ? { countryCode: best.code, local: clean.slice(best.dialCode.length) } : { countryCode: 'ID', local: clean }
}
