import { Prisma } from '@prisma/client'

// Transaksi Serializable (terbit booking + nomor invoice + kuota) bisa dibatalkan Postgres saat dua penerbitan menyentuh baris yang sama (penghitung nomor, kursi):
// P2034 dari ORM, atau 40001 lewat SQL mentah (P2010). Itu bukan galat pengguna — transaksi aman diulang dari awal karena semua bacaan ada di dalamnya (SEC-113).
export function isSerializationConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && (e.meta as { code?: string } | undefined)?.code === '40001'))
}

/** Jalankan `run` (satu transaksi utuh); bentrok serialisasi → ulang sampai `attempts` kali dengan jeda acak pendek. Galat lain dilempar apa adanya. */
export async function retrySerializable<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run()
    } catch (e) {
      if (!isSerializationConflict(e) || i >= attempts) throw e
      await new Promise(r => setTimeout(r, 20 + Math.floor(Math.random() * 60) * i))
    }
  }
}
