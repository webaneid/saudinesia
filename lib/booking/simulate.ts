import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { InvoiceError, taxFor } from '@/lib/invoice/issue'
import type { TaxLine } from '@/lib/invoice/tax'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceLineItem } from '@/lib/pdf/invoiceData'
import { itemSellTotals, type ItemMeta } from '@/lib/pricing/engine/snapshot'
import { prepareBooking, writeBooking, RuleViolationError, type BookingInput } from './create'
import { NextResponse } from 'next/server'
import { apiErrorText, type ApiErrorCode } from '@/lib/errors/api'
import type { ApiErrorParams } from '@/lib/errors/params'
import { ItemNotBookableError, QuotaExhaustedError, itemIndexOf } from './errors'
import { isRetryableConflict } from './serializable'
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

/**
 * `itemIndex` = item masukan (urut `items`) penyebab galat. `code`/`params` = kunci katalog `apiErrors` untuk pelanggan (I6b, §6.8);
 * `message` = teks Indonesia (admin, `/id`). Pelanggaran aturan visa membawa kodenya sendiri per pelanggaran.
 */
export type BookingFailure = { ok: false; status: 404 | 409 | 422; message: string; code: ApiErrorCode; params?: ApiErrorParams; violations?: RuleViolation[]; itemIndex?: number }

/** Galat mesin pesan → jawaban terarah (422 aturan/tak dapat dijual, 409 kuota/bentrok). Galat lain dilempar ulang (500 + log di pemanggil). */
const coded = (code: ApiErrorCode) => ({ ok: false as const, message: apiErrorText(code), code })

/** Respons galat mesin pesan untuk pelanggan: teks Indonesia + `meta` berkode (dan pelanggaran aturan visa bila ada). */
export function bookingFailureJson(f: BookingFailure): NextResponse {
  return NextResponse.json({
    // `orderNotIssuable` membawa detail InvoiceError untuk log admin — pelanggan hanya menerima teks katalog.
    success: false, error: f.code === 'orderNotIssuable' ? apiErrorText(f.code) : f.message,
    meta: { code: f.code, ...(f.params ? { params: f.params } : {}), ...(f.violations ? { violations: f.violations } : {}) },
  }, { status: f.status })
}

export function bookingFailure(e: unknown): BookingFailure {
  const r = failureOf(e)
  const itemIndex = itemIndexOf(e)
  return itemIndex === undefined ? r : { ...r, itemIndex }
}

function failureOf(e: unknown): BookingFailure {
  if (e instanceof RuleViolationError) {
    const first = e.violations[0]
    return { ok: false, status: 422, message: e.message, code: first?.code ?? 'visaRuleInvalid', ...(first ? { params: first.params } : {}), violations: e.violations }
  }
  if (e instanceof ItemNotBookableError || e instanceof QuotaExhaustedError) {
    return { ok: false, status: e instanceof QuotaExhaustedError ? 409 : 422, message: e.message, code: e.code, ...(e.params ? { params: e.params } : {}) }
  }
  // Setelan invoice bermasalah = urusan admin: rinciannya di `message` (admin), pelanggan menerima kode umum.
  if (e instanceof InvoiceError) return { ok: false, status: 422, message: e.message, code: 'orderNotIssuable' }
  // Bentrok serialisasi yang masih tersisa setelah diulang (retrySerializable) — mis. beberapa pesanan serentak pada kursi yang sama.
  if (isRetryableConflict(e)) return { status: 409, ...coded('orderConflict') }
  // Id produk/jadwal yang (sudah) tidak ada — masukan, bukan galat server (SEC-130).
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { status: 422, ...coded('productNotFound') }
  throw e
}
