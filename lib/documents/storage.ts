import { randomUUID } from 'node:crypto'
import { uploadBuffer, deleteObject, getPresignedUrl, deleteObjectsByPrefix } from '@/lib/storage/minio'

// Batas ke MinIO untuk dokumen jamaah — antarmuka kecil supaya layanan bisa diuji dengan penyimpanan memori (pola lib/media/storage.ts).
// Kunci: `saved-pilgrims/{pemilik}/{kartu}/{jenis}/{ms}-{acak}.{ext}` — diawali PEMILIK (bukan hanya kartu) supaya penghapusan akun bisa
// menyapu semua berkas akun lewat satu awalan meski kartunya sudah terhapus. Nama berkas asli TIDAK dipakai (bisa memuat nama orang).
export type DocumentStorage = {
  put: (key: string, body: Buffer, mime: string) => Promise<void>
  remove: (key: string) => Promise<void>
  removePrefix: (prefix: string) => Promise<number>
  url: (key: string, ttlSeconds: number) => Promise<string>
}

export const minioDocumentStorage: DocumentStorage = {
  put: uploadBuffer,
  remove: deleteObject,
  removePrefix: (prefix) => deleteObjectsByPrefix(prefix),
  url: getPresignedUrl,
}

export const ownerDocPrefix = (ownerId: string) => `saved-pilgrims/${ownerId}/`
export const cardDocPrefix = (ownerId: string, cardId: string) => `saved-pilgrims/${ownerId}/${cardId}/`
export const newDocumentKey = (ownerId: string, cardId: string, typeKey: string, ext: string) =>
  `${cardDocPrefix(ownerId, cardId)}${typeKey}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`

/** Hapus objek best-effort SESUDAH commit (baris sudah tiada) — kegagalan hanya dicatat; sisa berkas berada di bawah awalan kartu/pemilik
 *  yang disapu saat kartu dihapus atau akun dihapus. Log tanpa kunci objek (memuat id pemilik). */
export async function removeObjectsQuietly(storage: DocumentStorage, keys: string[], tag: string): Promise<void> {
  const results = await Promise.allSettled(keys.map(k => storage.remove(k)))
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) console.error(`[${tag}] ${failed} berkas dokumen gagal dihapus dari penyimpanan`)
}
