import { Prisma } from '@prisma/client'

// Transaksi Serializable (terbit booking + nomor invoice + kuota) bisa dibatalkan Postgres saat dua penerbitan menyentuh baris yang sama (penghitung nomor, kursi):
// P2034 dari ORM, atau 40001 lewat SQL mentah (P2010). Itu bukan galat pengguna — transaksi aman diulang dari awal karena semua bacaan ada di dalamnya (SEC-113).
export function isSerializationConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && (e.meta as { code?: string } | undefined)?.code === '40001'))
}

/** Jalankan `run` (satu transaksi utuh); bentrok serialisasi ATAU deadlock (`FOR UPDATE` mentah atas baris kursi, mis. keberangkatan paket K1 — SEC-233)
 *  → ulang sampai `attempts` kali dengan jeda acak pendek. Galat lain dilempar apa adanya. */
export async function retrySerializable<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run()
    } catch (e) {
      if (!isRetryableConflict(e) || i >= attempts) throw e
      await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 60) * i))
    }
  }
}

/** Bentrok yang aman diulang dari awal: serialisasi (di atas) ATAU deadlock (40P01; P2034 dari ORM juga mencakupnya). Dipakai transaksi
 *  READ COMMITTED yang mengunci baris lintas tabel dalam urutan berbeda (gabung identitas vs verifikasi/tautan jamaah, lib/pilgrims). */
export function isRetryableConflict(e: unknown): boolean {
  return isSerializationConflict(e) || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2010' && (e.meta as { code?: string } | undefined)?.code === '40P01')
}

/** Seperti `retrySerializable` untuk `isRetryableConflict`. */
export async function retryConflict<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run()
    } catch (e) {
      if (!isRetryableConflict(e) || i >= attempts) throw e
      await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 60) * i))
    }
  }
}
