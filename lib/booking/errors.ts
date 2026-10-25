/** Item booking yang ditolak karena belum/tidak bisa dijual (bukan kuota habis): mis. produk nonaktif atau belum berharga. Dipetakan ke 422. */
export class ItemNotBookableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ItemNotBookableError'
  }
}
