import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { InvoiceError, taxFor } from '@/lib/invoice/issue'
import type { TaxLine } from '@/lib/invoice/tax'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceLineItem } from '@/lib/pdf/invoiceData'
import { itemSellTotals, type ItemMeta } from '@/lib/pricing/engine/snapshot'
import { prepareBooking, writeBooking, RuleViolationError, type BookingInput } from './create'
import { ItemNotBookableError, itemIndexOf } from './errors'
import { isSerializationConflict } from './serializable'
import type { RuleViolation } from './rules'

// Pratinjau pesan (docs/arsitektur-booking-engine-v2.md §10.3, §10.5): akibat terbit TANPA terbit — mesin yang SAMA (`prepareBooking` → `writeBooking`) dijalankan di
// transaksi yang SELALU di-rollback, jadi angka, baris invoice, pelanggaran aturan, dan galat kuota sama persis dengan saat terbit. Dipakai draf admin (baris draf
// yang sudah ada) dan checkout pelanggan (baris booking SEMENTARA yang dibuat di dalam transaksi ini dan ikut di-rollback — tak pernah tersimpan, tanpa nomor
// invoice, tanpa kode dari penghitung). Hanya harga JUAL yang keluar (baris invoice + pajak + total); modal tak pernah dibaca di sini.

export type BookingPreview = {
  lines: InvoiceLineItem[]
  /** Σ baris (sebelum pajak). */
  total: number
  /** Pajak menurut aturan TERKINI (dibekukan saat terbit). */
  tax: TaxLine[]
  taxAdded: number
  /** Yang akan ditagihkan = total + pajak ditambahkan. */
  grandTotal: number
  dueDays: number
  /** Harga jual tiap item, URUT `input.items`. */
  itemTotals: number[]
  /** Harga jual visa milik tiap jamaah, URUT `input.pilgrims` (0 = tanpa visa sendiri). */
  pilgrimVisaTotals: number[]
}

/** Sasaran simulasi: baris booking yang sudah ada (draf admin) ATAU pemilik untuk baris sementara (checkout). */
export type SimulationTarget = { bookingId: string } | { userId: string }

class Rollback extends Error { constructor(public readonly result: BookingPreview) { super('rollback') } }

/** Satu simulasi terbit di transaksi yang selalu di-rollback; galat mesin diteruskan apa adanya (petakan dengan `bookingFailure`). */
export async function simulateBooking(target: SimulationTarget, input: BookingInput, dueDays: number): Promise<BookingPreview> {
  try {
    const prepared = await prepareBooking(input)
    await prisma.$transaction(async (tx) => {
      // Baris sementara: kode acak non-penghitung (tak pernah commit, jadi tak terlihat oleh `withBookingCode`), status `active` seperti hasil terbit.
      const id = 'bookingId' in target
        ? target.bookingId
        : (await tx.booking.create({ data: { bookingCode: `PRATINJAU-${randomUUID()}`, userId: target.userId, status: 'active', season: 'regular', totalAmount: 0 }, select: { id: true } })).id
      const written: ItemMeta[] = []
      await writeBooking(tx, prepared, id, written)
      const full = await tx.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude })
      const inv = await buildInvoiceData(full, tx)
      const tax = await taxFor(tx, inv.subtotal)
      const sells = await itemSellTotals(tx, id)
      const itemTotals = input.items.map((_, i) => { const m = written[i]; return m ? sells.get(`${m.itemType}:${m.itemId}`) ?? 0 : 0 })
      // Visa ditulis SESUDAH item, satu meta per jamaah bervisa sendiri, urut jamaah (lib/booking/lineItems.ts).
      const visaMetas = written.slice(input.items.length)
      let k = 0
      const pilgrimVisaTotals = input.pilgrims.map(p => { if (!p.visaProductId) return 0; const m = visaMetas[k++]; return m ? sells.get(`${m.itemType}:${m.itemId}`) ?? 0 : 0 })
      throw new Rollback({ lines: inv.lineItems, total: inv.subtotal, tax: tax.lines, taxAdded: tax.addedIdr, grandTotal: inv.subtotal + tax.addedIdr, dueDays, itemTotals, pilgrimVisaTotals })
    }, { isolationLevel: 'Serializable' })
  } catch (e) {
    if (e instanceof Rollback) return e.result
    throw e
  }
  throw new Error('pratinjau tidak di-rollback') // tak terjangkau: transaksi di atas selalu melempar Rollback
}

/** `itemIndex` = item masukan (urut `items`) penyebab galat. */
export type BookingFailure = { ok: false; status: 404 | 409 | 422; message: string; violations?: RuleViolation[]; itemIndex?: number }

/** Galat mesin pesan → jawaban terarah (422 aturan/tak dapat dijual, 409 kuota/bentrok). Galat lain dilempar ulang (500 + log di pemanggil). */
export function bookingFailure(e: unknown): BookingFailure {
  const r = failureOf(e)
  const itemIndex = itemIndexOf(e)
  return itemIndex === undefined ? r : { ...r, itemIndex }
}

function failureOf(e: unknown): BookingFailure {
  if (e instanceof RuleViolationError) return { ok: false, status: 422, message: e.message, violations: e.violations }
  if (e instanceof ItemNotBookableError) return { ok: false, status: 422, message: e.message }
  if (e instanceof InvoiceError) return { ok: false, status: 422, message: e.message }
  if (e instanceof Error && (e.message.includes('insufficient') || e.message.includes('capacity'))) return { ok: false, status: 409, message: e.message }
  // Bentrok serialisasi yang masih tersisa setelah diulang (retrySerializable) — mis. beberapa pesanan serentak pada kursi yang sama.
  if (isSerializationConflict(e)) return { ok: false, status: 409, message: 'Pesanan sedang diproses di tempat lain — coba lagi' }
  // Id produk/jadwal yang (sudah) tidak ada — masukan, bukan galat server (SEC-130).
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { ok: false, status: 422, message: 'Produk yang dipilih tidak ditemukan lagi — pilih ulang' }
  throw e
}
