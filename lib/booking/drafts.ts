import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { bookingDraftSchema, type BookingDraft } from '@/lib/validators/booking'
import { generateBookingCode } from '@/lib/utils/bookingCode'
import { detectSeason } from '@/lib/utils/season'
import { getInvoiceSettings } from '@/lib/invoice/settings'
import { isDeletedAccount } from '@/lib/customers/query'
import { buildInvoiceData, invoiceBookingInclude, type InvoiceLineItem } from '@/lib/pdf/invoiceData'
import { paymentDeadlineFor } from './lifecycle'
import { prepareBooking, writeBooking, RuleViolationError, type BookingInput } from './create'
import { ItemNotBookableError } from './errors'
import type { RuleViolation } from './rules'

// Draf booking admin (docs/arsitektur-booking-engine-v2.md §10.3, D3). Draf = baris `Booking` berstatus `draft` + masukan pesan di kolom `draft` (JSON) — TANPA item,
// kuota, snapshot, atau jejak. Pratinjau menjalankan mesin pesan yang sama (lib/booking/create.ts) di transaksi yang di-rollback; terbit menjalankannya sungguhan.

export type DraftError = { ok: false; status: 404 | 409 | 422; message: string; violations?: RuleViolation[] }
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
  const b = await prisma.booking.create({
    data: { bookingCode: await generateBookingCode(), userId: customerId, status: 'draft', season: 'regular', totalAmount: 0, draft: EMPTY as Prisma.InputJsonValue },
    select: { id: true, bookingCode: true },
  })
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
  total: number
  dueDays: number
  warnings: RuleViolation[]
}

class Rollback extends Error { constructor(public readonly result: DraftPreview) { super('rollback') } }

/** Akibat terbit, TANPA terbit: angka, baris invoice, pelanggaran aturan, dan galat kuota sama persis dengan saat terbit; seluruh tulisan di-rollback. */
export async function previewDraft(id: string): Promise<{ ok: true; preview: DraftPreview } | DraftError> {
  const b = await prisma.booking.findUnique({ where: { id }, select: { status: true, userId: true, draft: true } })
  if (!b || b.status !== 'draft') return { ok: false, status: 404, message: 'Draf tidak ditemukan' }
  const draft = readDraft(b.draft)
  if (draft.items.length === 0 && draft.pilgrims.every(p => !p.visaProductId)) return { ok: false, status: 422, message: 'Tambahkan minimal satu produk' }
  const dueDays = draft.dueDays ?? (await getInvoiceSettings()).defaultDueDays
  try {
    const prepared = await prepareBooking(draftInput(draft), b.userId)
    await prisma.$transaction(async (tx) => {
      await writeBooking(tx, prepared, id)
      const full = await tx.booking.findUniqueOrThrow({ where: { id }, include: invoiceBookingInclude })
      const inv = await buildInvoiceData(full)
      throw new Rollback({ lines: inv.lineItems, total: inv.subtotal, dueDays, warnings: prepared.warnings })
    }, { isolationLevel: 'Serializable' })
    throw new Error('pratinjau tidak di-rollback') // tak terjangkau: transaksi di atas selalu melempar Rollback
  } catch (e) {
    if (e instanceof Rollback) return { ok: true, preview: e.result }
    return failure(e)
  }
}

/** Terbitkan: draf dikunci, mesin pesan menulis item ke baris yang sama, status `draft → active`, isi draf dikosongkan, jatuh tempo ditetapkan (D4). Atomik. */
export async function publishDraft(id: string, input: { dueDays?: number; expectedUpdatedAt?: string }): Promise<{ ok: true; id: string; bookingCode: string } | DraftError> {
  const b = await prisma.booking.findUnique({ where: { id }, select: { status: true, userId: true, draft: true } })
  if (!b || b.status !== 'draft') return { ok: false, status: 404, message: 'Draf tidak ditemukan' }
  const draft = readDraft(b.draft)
  if (draft.items.length === 0 && draft.pilgrims.every(p => !p.visaProductId)) return { ok: false, status: 422, message: 'Tambahkan minimal satu produk' }
  const dueDays = input.dueDays ?? draft.dueDays ?? (await getInvoiceSettings()).defaultDueDays
  try {
    const prepared = await prepareBooking(draftInput(draft), b.userId)
    return await prisma.$transaction(async (tx) => {
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
          paymentDeadline: paymentDeadlineFor(new Date(), dueDays),
          season: dated.departureDate ? await detectSeason(dated.departureDate) : 'regular',
        },
        select: { id: true, bookingCode: true },
      })
      return { ok: true as const, ...done }
    }, { isolationLevel: 'Serializable' })
  } catch (e) {
    return failure(e)
  }
}

function failure(e: unknown): DraftError {
  if (e instanceof RuleViolationError) return { ok: false, status: 422, message: e.message, violations: e.violations }
  if (e instanceof ItemNotBookableError) return { ok: false, status: 422, message: e.message }
  if (e instanceof Error && (e.message.includes('insufficient') || e.message.includes('capacity'))) return { ok: false, status: 409, message: e.message }
  // Bentrok serialisasi (transaksi Serializable): P2034 dari ORM, atau 40001 dari SQL mentah (`SELECT … FOR UPDATE` di lockDraft, P2010) — mis. dua terbit serentak.
  if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2034' || (e.code === 'P2010' && (e.meta as { code?: string } | undefined)?.code === '40001'))) {
    return { ok: false, status: 409, message: 'Draf sedang diproses di tempat lain — muat ulang lalu coba lagi' }
  }
  // Id produk/jadwal di draf yang (sudah) tidak ada — draf disimpan bebas, jadi ini masukan, bukan galat server (SEC-130 untuk jalur draf).
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') return { ok: false, status: 422, message: 'Ada produk di draf yang tidak ditemukan lagi — hapus atau pilih ulang' }
  throw e
}
