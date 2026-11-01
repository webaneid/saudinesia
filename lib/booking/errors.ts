/** Item booking yang ditolak karena belum/tidak bisa dijual (bukan kuota habis): mis. produk nonaktif atau belum berharga. Dipetakan ke 422. */
export class ItemNotBookableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItemNotBookableError'
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
