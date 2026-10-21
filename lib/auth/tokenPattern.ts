/** 32 byte → 43 karakter base64url. Modul tanpa dependensi supaya aman diimpor validator/klien; dipakai menolak token berbentuk salah sebelum menyentuh DB. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
