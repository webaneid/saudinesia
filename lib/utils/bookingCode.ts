import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { yearInApp } from '@/lib/time'

// Kode booking `SND-<tahun zona aplikasi>-<urut 5 digit>`. Urut berikutnya = urut TERTINGGI tahun itu + 1 — bukan jumlah baris: draf dapat dihapus sungguhan
// (Fase 5), dan "jumlah + 1" lalu jatuh ke kode yang sudah ada sehingga SETIAP booking baru gagal. Kode boleh berlubang (bukan nomor invoice).
// Dua pembuat serentak bisa mendapat kode yang sama → `withBookingCode` mengulang saat kode bentrok (P2002 pada bookingCode).
export async function generateBookingCode(db: Pick<Prisma.TransactionClient, '$queryRaw'> = prisma): Promise<string> {
  const year = yearInApp()
  const prefix = `SND-${year}-`
  // $queryRaw: Prisma ORM tak bisa mengambil nilai maksimum dari bagian angka sebuah teks.
  const rows = await db.$queryRaw<Array<{ max: number | null }>>`
    SELECT max(substring("bookingCode" from ${prefix.length + 1}::int)::int) AS max
    FROM "bookings" WHERE "bookingCode" ~ ${`^SND-${year}-[0-9]+$`}`
  return `${prefix}${String((rows[0]?.max ?? 0) + 1).padStart(5, '0')}`
}

const isCodeClash = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('bookingCode')

/** Jalankan pembuatan booking dengan kode baru; kode bentrok dengan pembuat serentak → kode baru lalu ulang (maks. `attempts`). */
export async function withBookingCode<T>(create: (code: string) => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await create(await generateBookingCode())
    } catch (e) {
      if (!isCodeClash(e) || i >= attempts) throw e
    }
  }
}
