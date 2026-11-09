import type { CheckoutInput } from '@/lib/validators/checkout'
import { formatRupiah } from '@/lib/utils'

/** Isian per jenis melaporkan masukan checkout yang LENGKAP (atau null) + petunjuk isian yang masih kurang. */
export type FieldsChange = (input: CheckoutInput | null, missing: string | null) => void

/** Opsi ChoiceSelect dengan harga jual sebagai petunjuk di kanan (0 = tanpa angka). */
export const priceHint = (n: number, unit = ''): string | undefined => (n > 0 ? `${formatRupiah(n)}${unit}` : undefined)
