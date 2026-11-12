import { apiErrorText, type ApiErrorCode } from '@/lib/errors/api'
import type { ApiErrorParams } from '@/lib/errors/params'

// Galat mesin pesan BERKODE (docs/arsitektur-i18n-frontend.md §6.8, I6b): `code`/`params` = kunci katalog `apiErrors` untuk pelanggan;
// `message` = teks Indonesia katalog (admin dan log tak berubah) atau rincian Indonesia yang lebih spesifik (`detail`).

/** Barang yang dihargai — dipilih ICU `select` di pesan `itemPriceNotSet`/`itemVisaTierNotSet` (kedua bahasa). */
export type PriceSubject =
  | 'hotelRoom' | 'transport' | 'muthowif' | 'haji' | 'flight' | 'visa' | 'tourPackage' | 'umrahPackage'
  | 'chosenVehicle' | 'chosenHotel' | 'chosenHotelMakkah' | 'chosenHotelMadinah' | 'chosenVisa' | 'chosenFlight'

/** Item booking yang ditolak karena belum/tidak bisa dijual (bukan kuota habis): mis. produk nonaktif atau belum berharga. Dipetakan ke 422. */
export class ItemNotBookableError extends Error {
  constructor(readonly code: ApiErrorCode, readonly params?: ApiErrorParams, detail?: string) {
    super(detail ?? apiErrorText(code, params))
    this.name = 'ItemNotBookableError'
  }
}

/** Kuota/kapasitas tidak cukup (kamar, kursi, kuota haji, muthowif). Dipetakan ke 409 lewat `instanceof` — jangan mencocokkan teks pesan. */
export class QuotaExhaustedError extends Error {
  constructor(readonly code: ApiErrorCode, readonly params?: ApiErrorParams) {
    super(apiErrorText(code, params))
    this.name = 'QuotaExhaustedError'
  }
}

/**
 * Nomor baris item (urut masukan) yang menyebabkan galat — editor baris menampilkan galat di baris itu, bukan hanya di ringkasan.
 * Ditempel pada galat apa pun (item tak dapat dijual, kuota habis, produk tak ditemukan) tanpa mengubah jenis/pesannya.
 */
const ITEM_INDEX = Symbol('itemIndex')
type Tagged = { [ITEM_INDEX]?: number }

/** Tandai galat dengan nomor item (yang PALING dalam menang: tanda yang sudah ada tak ditimpa), lalu lempar ulang. */
export function tagItem(e: unknown, index: number): never {
  if (e instanceof Error && (e as Tagged)[ITEM_INDEX] === undefined) (e as Tagged)[ITEM_INDEX] = index
  throw e
}

/** Pemetaan ulang nomor (mis. revisi menulis SUBSET item: nomor subset → nomor baris editor), lalu lempar ulang. */
export function remapItemIndex(e: unknown, map: (index: number) => number | undefined): never {
  if (e instanceof Error) {
    const i = (e as Tagged)[ITEM_INDEX]
    if (i !== undefined) (e as Tagged)[ITEM_INDEX] = map(i)
  }
  throw e
}

export function itemIndexOf(e: unknown): number | undefined {
  return e instanceof Error ? (e as Tagged)[ITEM_INDEX] : undefined
}
