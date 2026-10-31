import type { BookingMuthowif } from '@prisma/client'
import {
  reservePoolMuthowifQuota, confirmPoolMuthowifQuota, releasePoolMuthowifQuota,
  confirmMuthowifQuota, releaseMuthowifQuota,
} from '@/lib/quota'
import type { QuotaAdapter, Tx } from './types'
import { calendarDateOf, dbDateOf, eachDay } from '@/lib/time'

function eachDate(start: Date, end: Date): Date[] {
  return [...eachDay(calendarDateOf(start), calendarDateOf(end))].map(dbDateOf)
}

// Dua lapis kapasitas (docs/arsitektur-muthowif.md §9.2-§9.4): pool (gabungan semua muthowif
// aktif, dicek saat booking dibuat) selalu di-confirm/release; individual (muthowifId spesifik,
// diisi admin assign belakangan) ikut di-confirm/release KALAU sudah di-assign.
export const muthowifAdapter: QuotaAdapter<BookingMuthowif> = {
  confirm: async (tx, row) => {
    for (const date of eachDate(row.startDate, row.endDate)) {
      await confirmPoolMuthowifQuota(tx, date, row.numPeople)
      if (row.muthowifId) await confirmMuthowifQuota(tx, row.muthowifId, date, row.numPeople)
    }
  },
  release: async (tx, row, o) => {
    for (const date of eachDate(row.startDate, row.endDate)) {
      await releasePoolMuthowifQuota(tx, date, row.numPeople, o.confirmed)
      if (row.muthowifId) await releaseMuthowifQuota(tx, row.muthowifId, date, row.numPeople, o.confirmed)
    }
  },
}

// reserve() dipanggil SEBELUM baris BookingMuthowif ada — cuma level pool (individual belum
// ditentukan saat booking dibuat, admin assign belakangan).
export async function reserveMuthowifPool(tx: Tx, startDate: Date, endDate: Date, numPeople: number) {
  for (const date of eachDate(startDate, endDate)) {
    await reservePoolMuthowifQuota(tx, date, numPeople)
  }
}
