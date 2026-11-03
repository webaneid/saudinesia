import { getCountryName } from '@/lib/constants/countries'
import { decryptPii, encryptPii, piiIndex, PiiDecryptError, timingSafeEqualHex } from './cipher'

// Nomor paspor — dienkripsi seperti NIK (keputusan pemilik K9) dan menjadi kunci identitas WNA (negara + nomor, C2). docs/arsitektur-jamaah.md §6.

export type PassportNumber = string & { readonly __passport: unique symbol }
export type SealedPassport = { keyHash: string; cipher: string; last4: string }

/** ASCII saja, huruf besar, tanpa spasi/tanda hubung; 5–20 huruf/angka (paspor RI: 1 huruf + 7 angka). `null` bila tidak sah. */
export function normalizePassport(input: string): PassportNumber | null {
  if (!/^[\x20-\x7E]*$/.test(input)) return null // non-ASCII ditolak SEBELUM toUpperCase ('ı'→'I', 'ß'→'SS', 'ﬁ'→'FI')
  const v = input.replace(/[ \-]/g, '').toUpperCase()
  return /^[A-Z0-9]{5,20}$/.test(v) ? (v as PassportNumber) : null
}

const countryOk = (code: string) => /^[A-Z]{2}$/.test(code) && getCountryName(code) !== null

/** Indeks identitas berbasis paspor: negara penerbit + nomor (nomor yang sama di dua negara = dua orang). */
export function passportIndex(countryCode: string, number: PassportNumber): string {
  if (!countryOk(countryCode)) throw new RangeError('Kode negara paspor tidak dikenal')
  return piiIndex('passport', `${countryCode}:${number}`)
}

export function sealPassport(countryCode: string, number: PassportNumber): SealedPassport {
  return { keyHash: passportIndex(countryCode, number), cipher: encryptPii('passport', number), last4: number.slice(-4) }
}

/** Buka nomor paspor utuh; `row` = negara + indeks yang tersimpan di baris yang sama (ciphertext dari baris lain ditolak). Pemanggil staf WAJIB mencatat pembukaan. */
export function openPassport(cipher: string, row: { countryCode: string; keyHash: string }): PassportNumber {
  const v = decryptPii('passport', cipher)
  if (normalizePassport(v) !== v) throw new RangeError('Isi ciphertext bukan nomor paspor')
  if (!timingSafeEqualHex(passportIndex(row.countryCode, v as PassportNumber), row.keyHash)) throw new PiiDecryptError('tidak cocok dengan indeks baris')
  return v as PassportNumber
}
