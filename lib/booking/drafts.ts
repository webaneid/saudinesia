import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingDraftSchema, type BookingDraft } from '@/lib/validators/booking'
import { withBookingCode } from '@/lib/utils/bookingCode'
import { detectSeason } from '@/lib/utils/season'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { InvoiceError, issueInvoice, taxFor } from '@/lib/invoice/issue'
import type { TaxLine } from '@/lib/invoice/tax'
import { isDeletedAccount } from '@/lib/customers/query'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceLineItem } from '@/lib/pdf/invoiceData'
import { itemSellTotals, type ItemMeta } from '@/lib/pricing/engine/snapshot'
import { prepareBooking, writeBooking, RuleViolationError, type BookingInput } from './create'
import { ItemNotBookableError, itemIndexOf } from './errors'
import { isSerializationConflict, retrySerializable } from './serializable'
import { partialItemTotals } from './partialTotals'
import type { RuleViolation } from './rules'

// Draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3, D3). Draf = baris `Booking` berstatus `draft` + masukan pesan di kolom `draft` (JSON) — TANPA item,
// kuota, snapshot, atau jejak. Pratinjau menjalankan mesin pesan yang sama (lib/booking/create.ts) di transaksi yang di-rollback; terbit menjalankannya sungguhan.

/** `itemIndex` = baris item draf (urut `draft.items`) penyebab galat — editor baris menampilkan galat di baris itu. */
export type DraftError = { ok: false; status: 404 | 409 | 422; message: string; violations?: RuleViolation[]; itemIndex?: number
  /** Pratinjau: subtotal baris lain saat satu baris gagal (`null` = baris gagal / tak dihitung). */ itemTotals?: (number | null)[] }
type Tx = Prisma.TransactionClient

const EMPTY: BookingDraft = { items: [], pilgrims: [{}] }

/** Isi draf → masukan mesin pesan. Data jamaah kosong (diisi setelah terbit, D3). */
export const draftInput = (d: BookingDraft): BookingInput => ({
  items: d.items,
  pilgrims: d.pilgrims.map(p => ({ fieldValues: {}, visaProductId: p.visaProductId, selectedDurationDays: p.selectedDurationDays })),
  totalPilgrims: d.pilgrims.length,
})

/** Baca isi draf tersimpan; data rusak/kosong → draf kosong (draf tak pernah membawa angka harga, jadi tak ada yang bisa "lolos" lewat sini). */
export function readDraft(json: unknown): BookingDraft {
  const parsed = bookingDraftSchema.safeParse(json)
  return parsed.success ? parsed.data : EMPTY
}

export async function createDraft(customerId: string): Promise<{ ok: true; id: string; bookingCode: string } | DraftError> {
  const customer = await prisma.user.findUnique({ where: { id: customerId }, select: { role: true, email: true, isActive: true } })
  if (!customer || customer.role !== 'pilgrim') return { ok: false, status: 404, message: 'Pelanggan tidak ditemukan' }
  if (isDeletedAccount(customer.email)) return { ok: false, status: 409, message: 'Akun pelanggan ini sudah dihapus' }
  if (!customer.isActive) return { ok: false, status: 409, message: 'Akun pelanggan ini nonaktif' }
  const b = await withBookingCode(bookingCode => prisma.booking.create({
    data: { bookingCode, userId: customerId, status: 'draft', season: 'regular', totalAmount: 0, draft: EMPTY as Prisma.InputJsonValue },
    select: { id: true, bookingCode: true },
  }))
  return { ok: true, ...b }
}

async function lockDraft(tx: Tx, id: string): Promise<{ status: string; draft: unknown; userId: string; updatedAt: Date } | null> {
  // $queryRaw: Prisma ORM tak punya SELECT … FOR UPDATE — simpan/terbit/hapus pada draf yang sama diserialkan.
  const rows = await tx.$queryRaw<Array<{ status: string; draft: unknown; userId: string; updatedAt: Date }>>(
    Prisma.sql`SELECT "status"::text AS status, "draft", "userId", "updatedAt" FROM "bookings" WHERE "id" = ${id} FOR UPDATE`,
  )
  return rows[0] ?? null
}

/** `expectedUpdatedAt` dari klien ≠ versi terkunci → basi. Tanpa nilai = tak diperiksa. */
const isStale = (expectedUpdatedAt: string | undefined, actual: Date) =>
  expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== actual.getTime()

/** Simpan isi draf. `expectedUpdatedAt` (opsional) mencegah dua tab saling menimpa diam-diam (409). */
export async function saveDraft(id: string, draft: BookingDraft, expectedUpdatedAt?: string): Promise<{ ok: true; updatedAt: Date } | DraftError> {
  return prisma.$transaction(async (tx) => {
    const row = await lockDraft(tx, id)
    if (!row || row.status !== 'draft') return { ok: false as const, status: 404 as const, message: 'Draf tidak ditemukan' }
    if (isStale(expectedUpdatedAt, row.updatedAt)) {
      return { ok: false as const, status: 409 as const, message: 'Draf sudah diubah di tempat lain — muat ulang halaman' }
    }
    const b = await tx.booking.update({ where: { id }, data: { draft: draft as Prisma.InputJsonValue }, select: { updatedAt: true } })
    return { ok: true as const, updatedAt: b.updatedAt }
  })
}

/** Hapus draf (hapus sungguhan: draf tak punya item, pembayaran, atau riwayat). Booking terbit tak pernah dihapus lewat sini. */
export async function deleteDraft(id: string): Promise<{ ok: true } | DraftError> {
  return prisma.$transaction(async (tx) => {
    const row = await lockDraft(tx, id)
    if (!row || row.status !== 'draft') return { ok: false as const, status: 404 as const, message: 'Draf tidak ditemukan' }
    await tx.booking.delete({ where: { id } })
    return { ok: true as const }
  })
}

export type DraftPreview = {
  lines: InvoiceLineItem[]
  /** Σ baris (sebelum pajak). */
  total: number
  /** Pajak menurut aturan TERKINI (dibekukan saat terbit). */
  tax: TaxLine[]
  taxAdded: number
  /** Yang akan ditagihkan = total + pajak ditambahkan. */
  grandTotal: number
  dueDays: number
  warnings: RuleViolation[]
  /** Harga jual tiap item, URUT `draft.items` (editor baris menampilkannya sebagai subtotal baris). */
  itemTotals: number[]
}

class Rollback extends Error { constructor(public readonly result: DraftPreview) { super('rollback') } }

/** Akibat terbit, TANPA terbit: angka, baris invoice, pelanggaran aturan, dan galat kuota sama persis dengan saat terbit; seluruh tulisan di-rollback. */
/** `override` = isi draf yang BELUM disimpan (editor baris memperbarui total otomatis saat mengetik) — divalidasi skema yang sama oleh route; tak ada yang disimpan. */
export async function previewDraft(id: string, override?: BookingDraft): Promise<{ ok: true; preview: DraftPreview } | DraftError> {
  const b = await prisma.booking.findUnique({ where: { id }, select: { status: true, userId: true, draft: true } })
  if (!b || b.status !== 'draft') return { ok: false, status: 404, message: 'Draf tidak ditemukan' }
  const draft = override ?? readDraft(b.draft)
  if (draft.items.length === 0 && draft.pilgrims.every(p => !p.visaProductId)) return { ok: false, status: 422, message: 'Tambahkan minimal satu produk' }
  const dueDays = draft.dueDays ?? (await getInvoiceSettings()).defaultDueDays
  try {
    return { ok: true, preview: await simulate(id, b.userId, draft, dueDays) }
  } catch (e) {
    const f = failure(e)
    if (f.itemIndex === undefined) return f
    // Satu baris gagal → subtotal baris lain tetap dihitung (tanpa baris itu); ringkasan tetap tak ditampilkan.
    const itemTotals = await partialItemTotals(draft.items.length, f.itemIndex, async keep =>
      (await simulate(id, b.userId, { ...draft, items: keep.map(i => draft.items[i]!) }, dueDays)).itemTotals)
    return { ...f, itemTotals }
  }
}

/** Satu simulasi terbit di transaksi yang selalu di-rollback; galat mesin diteruskan apa adanya. */
async function simulate(id: string, userId: string, draft: BookingDraft, dueDays: number): Promise<DraftPreview> {
  try {
    const prepared = await prepareBooking(draftInput(draft), userId)
    await prisma.$transaction(async (tx) => {
      const written: ItemMeta[] = []
      await writeBooking(tx, prepared, id, written)
      const full = await tx.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude })
      const inv = await buildInvoiceData(full)
      const tax = await taxFor(tx, inv.subtotal)
      const sells = await itemSellTotals(tx, id)
      const itemTotals = draft.items.map((_, i) => { const m = written[i]; return m ? sells.get(`${m.itemType}:${m.itemId}`) ?? 0 : 0 })
      throw new Rollback({ lines: inv.lineItems, total: inv.subtotal, tax: tax.lines, taxAdded: tax.addedIdr, grandTotal: inv.subtotal + tax.addedIdr, dueDays, warnings: prepared.warnings, itemTotals })
    }, { isolationLevel: 'Serializable' })
  } catch (e) {
    if (e instanceof Rollback) return e.result
    throw e
  }
  throw new Error('pratinjau tidak di-rollback') // tak terjangkau: transaksi di atas selalu melempar Rollback
}

/** Terbitkan: draf dikunci, mesin pesan menulis item ke baris yang sama, status `draft → active`, isi draf dikosongkan, jatuh tempo ditetapkan (D4). Atomik. */
export async function publishDraft(id: string, input: { dueDays?: number; expectedUpdatedAt?: string; byUserId: string | null }): Promise<{ ok: true; id: string; bookingCode: string; invoiceNumber: string } | DraftError> {
  const b = await prisma.booking.findUnique({ where: { id }, select: { status: true, userId: true, draft: true } })
  if (!b || b.status !== 'draft') return { ok: false, status: 404, message: 'Draf tidak ditemukan' }
  const draft = readDraft(b.draft)
  if (draft.items.length === 0 && draft.pilgrims.every(p => !p.visaProductId)) return { ok: false, status: 422, message: 'Tambahkan minimal satu produk' }
  const dueDays = input.dueDays ?? draft.dueDays ?? (await getInvoiceSettings()).defaultDueDays
  try {
    const prepared = await prepareBooking(draftInput(draft), b.userId)
    return await retrySerializable(() => prisma.$transaction(async (tx) => {
      const row = await lockDraft(tx, id)
      // Status DAN isi dibaca ulang di dalam kunci: terbit ganda / draf yang diubah sesudah dibaca tak boleh terbit dengan isi lama.
      if (!row || row.status !== 'draft') return { ok: false as const, status: 409 as const, message: 'Draf ini sudah diterbitkan atau dihapus' }
      if (JSON.stringify(readDraft(row.draft)) !== JSON.stringify(draft) || isStale(input.expectedUpdatedAt, row.updatedAt)) {
        return { ok: false as const, status: 409 as const, message: 'Draf sudah berubah sejak dipratinjau — muat ulang lalu pratinjau lagi' }
      }
      // Pemilik dibaca di dalam kunci barisnya: akun yang dihapus (UU PDP) atau dinonaktifkan sesudah draf dibuat tak boleh menerima booking baru.
      // Penghapusan akun mengunci baris pengguna yang sama dan menghapus drafnya (lib/account/deletion.ts), jadi keduanya terserialkan.
      const owner = await tx.$queryRaw<Array<{ email: string; isActive: boolean }>>( // Prisma ORM tak punya SELECT … FOR SHARE
        Prisma.sql`SELECT "email", "isActive" FROM "users" WHERE "id" = ${row.userId} FOR SHARE`,
      )
      if (!owner[0] || isDeletedAccount(owner[0].email)) return { ok: false as const, status: 409 as const, message: 'Akun pelanggan ini sudah dihapus' }
      if (!owner[0].isActive) return { ok: false as const, status: 409 as const, message: 'Akun pelanggan ini nonaktif — aktifkan dulu sebelum menerbitkan' }
      await writeBooking(tx, prepared, id)
      const dated = await tx.booking.findUniqueOrThrow({ where: { id }, select: { departureDate: true } })
      const done = await tx.booking.update({
        where: { id },
        data: {
          status: 'active', draft: Prisma.DbNull,
          season: dated.departureDate ? await detectSeason(dated.departureDate) : 'regular',
        },
        select: { id: true, bookingCode: true },
      })
      // Invoice (nomor, pajak beku, jatuh tempo) terbit di transaksi yang sama — gagal di mana pun = tak ada booking terbit dan tak ada nomor terpakai.
      const invoice = await issueInvoice(tx, id, { dueDays, byUserId: input.byUserId })
      return { ok: true as const, ...done, invoiceNumber: invoice.number }
    }, { isolationLevel: 'Serializable' }))
  } catch (e) {
    return failure(e)
  }
}

function failure(e: unknown): DraftError {
  const r = failureOf(e)
  const itemIndex = itemIndexOf(e)
  return itemIndex === undefined ? r : { ...r, itemIndex }
}

function failureOf(e: unknown): DraftError {
  if (e instanceof RuleViolationError) return { ok: false, status: 422, message: e.message, violations: e.violations }
  if (e instanceof ItemNotBookableError) return { ok: false, status: 422, message: e.message }
  if (e instanceof InvoiceError) return { ok: false, status: 422, message: e.message }
  if (e instanceof Error && (e.message.includes('insufficient') || e.message.includes('capacity'))) return { ok: false, status: 409, message: e.message }
  // Bentrok serialisasi yang masih tersisa setelah diulang (retrySerializable) — mis. tiga terbit serentak pada kursi yang sama.
  if (isSerializationConflict(e)) {
    return { ok: false, status: 409, message: 'Draf sedang diproses di tempat lain — muat ulang lalu coba lagi' }
  }
  // Id produk/jadwal di draf yang (sudah) tidak ada — draf disimpan bebas, jadi ini masukan, bukan galat server (SEC-130 untuk jalur draf).
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { ok: false, status: 422, message: 'Ada produk di draf yang tidak ditemukan lagi — hapus atau pilih ulang' }
  throw e
}
