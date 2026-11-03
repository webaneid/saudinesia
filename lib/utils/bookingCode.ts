import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { yearInApp } from '@/lib/time'

// Kode booking `SND-<tahun zona aplikasi>-<urut 5 digit>`. Urut berikutnya = urut TERTINGGI tahun itu + 1 — bukan jumlah baris: draf dapat dihapus sungguhan
// (Fase 5), dan "jumlah + 1" lalu jatuh ke kode yang sudah ada sehingga SETIAP booking baru gagal. Kode boleh berlubang (bukan nomor invoice), tetapi tak melompat saat gagal.
//
// Pembuat booking diserialkan: baca urut tertinggi → tulis baris → commit tak boleh tumpang tindih. Dulu bentrok diulang (maks. 5 kali), dan satu pembuat bisa kalah terus saat ramai.
// Kuncinya `LOCK TABLE`, BUKAN `pg_advisory_xact_lock`: `POST /bookings` berjalan Serializable, dan di sana snapshot diambil pada statement pertama yang memerlukannya — termasuk
// `SELECT pg_advisory_xact_lock(...)`, SEBELUM menunggu kunci. Pembacaan sesudahnya tak melihat commit rival sehingga transaksi gagal 40001 (terbukti: 9 dari 12 pembuat serentak).
// `LOCK TABLE` tak mengambil snapshot, jadi snapshot baru diambil sesudah kunci didapat. Itu berlaku hanya bila ia statement PERTAMA — karena itu `withBookingCode` membuka transaksinya sendiri.
// Menunggu kunci dibatasi `lock_timeout` di Postgres, bukan `timeout` Prisma: statement yang tertahan di LOCK TABLE tidak dibatalkan oleh Prisma (terbukti tertahan menit-menitan saat uji).
const LOCK_WAIT_MS = 10_000
const TX_LIMITS = { maxWait: 10_000, timeout: 20_000 } // bawaan Prisma (2 dtk/5 dtk) terlalu pendek karena waktu menunggu kunci ikut dihitung

type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; lockWaitMs?: number }

export class BookingCodeBusyError extends Error {}

// Antrean dalam proses DI DEPAN kunci DB: penunggu kunci memegang satu koneksi selama menunggu, dan pemegang kunci masih memerlukan koneksi lain (ada kueri `prisma.` global di jalur harga).
// Tanpa antrean, ledakan pesanan menghabiskan pool sehingga pemegang kunci — dan seluruh situs — ikut tertahan. Aplikasi berjalan satu replika; antrean ini hanya soal koneksi, kebenaran kode tetap dijaga kunci DB.
let queueTail: Promise<unknown> = Promise.resolve()

function inTurn<T>(waitMs: number, fn: () => Promise<T>): Promise<T> {
  const enqueuedAt = Date.now()
  const run = queueTail.then(() => {
    if (Date.now() - enqueuedAt > waitMs) throw new BookingCodeBusyError('Antrean kode booking penuh')
    return fn()
  })
  queueTail = run.catch(() => {})
  return run
}

/** Buat booking di dalam transaksi yang memegang kunci kode; `run` menerima `tx` dan kode berikutnya. Gagal → rollback, kode tak terpakai dan tak terlompati. */
export function withBookingCode<T>(run: (tx: Prisma.TransactionClient, bookingCode: string) => Promise<T>, { isolationLevel, lockWaitMs = LOCK_WAIT_MS }: Options = {}): Promise<T> {
  return inTurn(lockWaitMs, () => prisma.$transaction(async (tx) => {
    // $executeRaw: Prisma ORM tak punya LOCK TABLE. Mode EXCLUSIVE hanya berbenturan dengan pemegang kunci lain; tabelnya kosong dan khusus untuk ini (bukan `bookings`, yang tetap bebas dibaca/ditulis).
    // SET LOCAL juga tak mengambil snapshot; dikembalikan sesudahnya supaya tidak berlaku pada kunci baris kuota dan lain-lain di `run`. Angkanya internal (tak berasal dari masukan), dan SET tak menerima parameter.
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = ${Math.trunc(lockWaitMs)}`)
    await tx.$executeRaw`LOCK TABLE "booking_code_lock" IN EXCLUSIVE MODE`
    await tx.$executeRaw`SET LOCAL lock_timeout = DEFAULT`
    const year = yearInApp()
    const prefix = `SND-${year}-`
    // $queryRaw: Prisma ORM tak bisa mengambil nilai maksimum dari bagian angka sebuah teks.
    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT max(substring("bookingCode" from ${prefix.length + 1}::int)::int) AS max
      FROM "bookings" WHERE "bookingCode" ~ ${`^SND-${year}-[0-9]+$`}`
    return run(tx, `${prefix}${String((rows[0]?.max ?? 0) + 1).padStart(5, '0')}`)
  }, { ...TX_LIMITS, isolationLevel }))
}

/** Pembuat booking melebihi batas tunggu (antrean, kunci 55P03, atau koneksi/transaksi P2028) — bukan galat server; tak ada yang tertulis, aman dicoba lagi. */
export function isBookingCodeBusy(e: unknown): boolean {
  if (e instanceof BookingCodeBusyError) return true
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false
  return e.code === 'P2028' || (e.code === 'P2010' && (e.meta as { code?: string } | undefined)?.code === '55P03')
}
