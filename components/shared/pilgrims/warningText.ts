import type { PilgrimWarning } from '@/lib/pilgrims/service'

// Murni (tanpa komponen klien) — dipakai Server Component dan formulir.
/** Peringatan lunak dari masukan sendiri (bukan penolakan) — tampil sesudah simpan. */
export const WARNING_TEXT: Record<PilgrimWarning, string> = {
  date_part_invalid: 'Bagian tanggal lahir di NIK tampak tidak wajar — periksa kembali NIK.',
  birth_date_mismatch: 'Tanggal lahir di NIK berbeda dengan tanggal lahir yang diisi — periksa kembali.',
  gender_mismatch: 'Jenis kelamin di NIK berbeda dengan yang dipilih — periksa kembali.',
  province_unknown: 'Kode provinsi di NIK tidak dikenal — periksa kembali NIK.',
}
