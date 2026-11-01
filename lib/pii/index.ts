// Satu pintu data pribadi sensitif (NIK, nomor paspor) — docs/arsitektur-jamaah.md §6, ADR-0005. Hanya untuk server (node:crypto).
// Modul lain mengimpor dari sini, bukan dari ./cipher atau ./keys (dijaga scripts/test-pii.ts).
export { normalizeNik, nikProblem, nikProvinceCode, nikHints, sealNik, nikIndex, openNik, type Nik, type NikHint, type SealedNik } from './nik'
export { normalizePassport, passportIndex, sealPassport, openPassport, type PassportNumber, type SealedPassport } from './passport'
export { needsReencrypt, PiiDecryptError } from './cipher'
export { NIK_MASK, maskPassport } from './mask'
