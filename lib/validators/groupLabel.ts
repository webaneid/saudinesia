import { z } from 'zod'

/**
 * Nama rombongan (Fase 11d): teks bebas pemesan, ≤ 60, tanpa karakter kontrol. Modul murni tanpa impor server — dipakai skema draf admin
 * (`bookingGroupSchema`) DAN skema keranjang pelanggan (`checkoutCartSchema`, dijangkau komponen klien).
 */
export const groupLabelSchema = z.string().trim().min(1).max(60, 'Nama rombongan maksimal 60 karakter').regex(/^[^\p{Cc}]*$/u, 'Nama rombongan tidak boleh memuat karakter kontrol')
