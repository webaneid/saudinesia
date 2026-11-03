import { isCalendarDate, type CalendarDate } from '@/lib/time'
import { decryptPii, encryptPii, piiIndex, PiiDecryptError, timingSafeEqualHex } from './cipher'

// NIK (Nomor Induk Kependudukan, 16 digit) — docs/arsitektur-jamaah.md §4.1/§6.
// Struktur: 2 digit provinsi · 2 kab/kota · 2 kecamatan · DDMMYY tanggal lahir (DD + 40 untuk perempuan) · 4 digit urut.
// Aturan KERAS hanya bentuk (16 digit, provinsi bukan 0x, urut bukan 0000). Kecocokan tanggal lahir/jenis kelamin hanya PETUNJUK:
// NIK lama/hasil pindah domisili bisa menyimpang, jadi tak boleh menolak orang sungguhan.

export type Nik = string & { readonly __nik: unique symbol }
export type NikHint = 'date_part_invalid' | 'birth_date_mismatch' | 'gender_mismatch'
// TANPA digit polos apa pun (SEC-165): digit 1–6 = kode kecamatan (ada di Address) dan 7–12 = tanggal lahir (ada di kolom lain), sehingga 4 digit
// terakhir yang disimpan polos melengkapi NIK utuh tanpa kunci. Tampilan tersamar = NIK_MASK; nilai utuh hanya lewat openNik.
export type SealedNik = { hash: string; cipher: string }

/** Buang spasi, titik, dan tanda hubung (bentuk tulisan KTP/fotokopi); `null` bila hasilnya bukan NIK yang sah. */
export function normalizeNik(input: string): Nik | null {
  const digits = input.replace(/[\s.\-]/g, '')
  return nikProblem(digits) === null ? (digits as Nik) : null
}

/** Alasan NIK ditolak (bentuk saja), atau `null` bila sah. */
export function nikProblem(nik: string): string | null {
  if (!/^\d{16}$/.test(nik)) return 'NIK harus 16 digit angka'
  if (nik.startsWith('0')) return 'Kode provinsi NIK tidak dikenal'
  if (nik.endsWith('0000')) return 'Nomor urut NIK tidak valid'
  return null
}

/** 2 digit kode provinsi (dicocokkan dengan `address_provinces` oleh pemanggil yang punya akses DB). */
export const nikProvinceCode = (nik: Nik): string => nik.slice(0, 2)

/** Petunjuk ketidakcocokan dengan data yang diketik — untuk peringatan formulir, BUKAN penolakan. */
export function nikHints(nik: Nik, given: { birthDate?: CalendarDate | null; gender?: 'male' | 'female' | null }): NikHint[] {
  const dd = Number(nik.slice(6, 8))
  const mm = Number(nik.slice(8, 10))
  const yy = nik.slice(10, 12)
  const female = dd > 40
  const day = female ? dd - 40 : dd
  if (day < 1 || day > 31 || mm < 1 || mm > 12) return ['date_part_invalid']
  const hints: NikHint[] = []
  if (given.birthDate && isCalendarDate(given.birthDate)) {
    const [y, m, d] = given.birthDate.split('-')
    if (y!.slice(2) !== yy || Number(m) !== mm || Number(d) !== day) hints.push('birth_date_mismatch')
  }
  if (given.gender && (given.gender === 'female') !== female) hints.push('gender_mismatch')
  return hints
}

/** Indeks unik (HMAC berkunci) + ciphertext — dua kolom yang disimpan untuk satu NIK. */
export function sealNik(nik: Nik): SealedNik {
  return { hash: nikIndex(nik), cipher: encryptPii('nik', nik) }
}

export const nikIndex = (nik: Nik): string => piiIndex('nik', nik)

/**
 * Buka NIK utuh. `expectedHash` = indeks yang tersimpan di BARIS yang sama: ciphertext yang disalin dari baris lain (tukar identitas lewat akses
 * tulis DB) ditolak. Pemanggil staf WAJIB mencatat pembukaan (PilgrimIdentityEvent `nik_revealed`, Fase 2+).
 */
export function openNik(cipher: string, expectedHash: string): Nik {
  const nik = decryptPii('nik', cipher)
  if (nikProblem(nik) !== null) throw new RangeError('Isi ciphertext bukan NIK')
  if (!timingSafeEqualHex(nikIndex(nik as Nik), expectedHash)) throw new PiiDecryptError('tidak cocok dengan indeks baris')
  return nik as Nik
}
