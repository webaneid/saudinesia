// Hapus-aman untuk entitas admin (aturan "CRUD lengkap selalu", docs/arsitektur-admin-create.md §6): hapus SUNGGUHAN hanya bila tak ada yang
// merujuk; selain itu NONAKTIF (riwayat tak boleh yatim) dan pemanggil mendapat pesan. Tabrakan FK saat menghapus (rujukan baru masuk di antara
// pemeriksaan dan hapus) jatuh ke jalur nonaktif — bukan 500. `P2025` (baris sudah hilang) dilempar ulang agar route memetakannya ke 404.

export type DeleteOutcome =
  | { deleted: true }
  | { deleted: false; deactivated: true; message: string }

const code = (e: unknown) => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined)

export async function deleteOrDeactivate(opts: {
  /** Jumlah rujukan (relasi) yang mencegah hapus fisik. */
  references: () => Promise<number>
  remove: () => Promise<unknown>
  deactivate: () => Promise<unknown>
  /** Teks "dipakai oleh …" untuk pesan; diberi jumlah rujukan. */
  usedBy: (count: number) => string
}): Promise<DeleteOutcome> {
  const deactivated = async (count: number): Promise<DeleteOutcome> => {
    await opts.deactivate()
    return {
      deleted: false, deactivated: true,
      message: `${opts.usedBy(count)} sehingga tidak dihapus — dinonaktifkan (tidak muncul di pilihan baru; riwayat tetap aman) dan dapat diaktifkan kembali.`,
    }
  }
  const count = await opts.references()
  if (count > 0) return deactivated(count)
  try {
    await opts.remove()
    return { deleted: true }
  } catch (e) {
    if (code(e) === 'P2003') return deactivated(await opts.references())
    throw e
  }
}
