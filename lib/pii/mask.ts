// Tampilan tersamar — murni (boleh di klien, satu-satunya bagian lib/pii yang boleh diimpor komponen klien).
// NIK SELALU tersamar penuh: tak ada digit NIK polos yang disimpan (SEC-165) — nilai utuh hanya lewat openNik di server.
// Paspor: 4 karakter terakhir (`passportLast4`) aman ditampilkan karena nomor paspor tak bisa diturunkan dari kolom lain.
export const NIK_MASK = '•••• •••• •••• ••••'

/** "••••4567"; bentuk lain (kosong/bukan 4 karakter) → string kosong, bukan nilai mentah. */
export function maskPassport(last4: string | null | undefined): string {
  return last4 && /^[A-Z0-9]{4}$/.test(last4) ? `••••${last4}` : ''
}
