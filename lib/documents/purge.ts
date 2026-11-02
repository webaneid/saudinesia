import type { Prisma } from '@prisma/client'

// Penghapusan baris dokumen jamaah yang ikut terhapus bersama pemiliknya (kartu dihapus sungguhan, akun dihapus) — tetap di lib/documents
// supaya penulis tabel `pilgrim_documents` hanya satu folder. Pemanggil yang menghapus objeknya (urutan berbeda per jalur, lihat pemanggil).
type Tx = Prisma.TransactionClient

/** Kunci objek dokumen kartu-kartu ini — dibaca sebelum barisnya dihapus. */
export async function documentKeysOfCards(tx: Tx, cardIds: string[]): Promise<string[]> {
  if (cardIds.length === 0) return []
  const rows = await tx.pilgrimDocument.findMany({ where: { savedPilgrimId: { in: cardIds } }, select: { objectKey: true } })
  return rows.map(r => r.objectKey)
}

/** Hapus baris dokumen kartu-kartu ini (FK Restrict: wajib sebelum kartu dihapus). */
export async function deleteDocumentRowsOfCards(tx: Tx, cardIds: string[]): Promise<number> {
  if (cardIds.length === 0) return 0
  return (await tx.pilgrimDocument.deleteMany({ where: { savedPilgrimId: { in: cardIds } } })).count
}
