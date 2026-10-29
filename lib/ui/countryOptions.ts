import { COUNTRIES } from '@/lib/constants/countries'
import type { ComboOption } from '@/lib/ui/combobox'

/** Pilihan "Negara" (alamat luar negeri, negara vendor): bendera + nama, kode ISO ikut dicari. Satu definisi untuk semua formulir. */
export const COUNTRY_OPTIONS: ComboOption[] = COUNTRIES.map(c => ({ id: c.code, label: c.name, flag: c.code, keywords: c.code }))
