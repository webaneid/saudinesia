import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { displayStatusOf, statusSelect, type DisplayStatus } from '@/lib/booking/lifecycle'
import { paginate, type ListParams, type PageMeta } from '@/lib/admin/pagination'
import { getCountryName } from '@/lib/constants/countries'
import { escapeLike } from '@/lib/utils/search'

// SATU pembaca daftar/detail Pelanggan untuk dashboard admin (docs/arsitektur-pelanggan.md). Pelanggan = `User` ber-`role = pilgrim`; staf tak pernah ikut.
// `select` selalu eksplisit: `passwordHash`, `googleSub`, token, dan `sessionVersion` TIDAK PERNAH dibaca (dijaga scripts/test-customers.ts).
// Pemanggil (halaman admin) wajib sudah memanggil `requireAdminPage` — modul ini tak memeriksa sesi.

export type CustomerFilters = {
  /** Cari nama, email, HP, atau WhatsApp (≤ 100 karakter). */
  q?: string
  active?: 'active' | 'inactive'
  email?: 'verified' | 'unverified'
  bookings?: 'with' | 'without'
}

export const ACTIVE_FILTERS = ['active', 'inactive'] as const
export const EMAIL_FILTERS = ['verified', 'unverified'] as const
export const BOOKING_FILTERS = ['with', 'without'] as const

export type CustomerRow = {
  id: string; fullName: string; email: string; phone: string | null; whatsapp: string | null
  whatsappVerified: boolean; emailVerified: boolean; isActive: boolean; createdAt: Date
  /** Akun yang sudah dianonimkan (UU PDP): tak ada data pribadi lagi. */
  deleted: boolean
  bookingCount: number
  /** Σ pembayaran berstatus `confirmed` (rupiah). */
  paidIdr: number
}

export const isDeletedAccount = (email: string): boolean => email.startsWith('deleted-') && email.endsWith('@deleted.invalid')

const LIST_SELECT = { id: true, fullName: true, email: true, phone: true, whatsapp: true, whatsappVerifiedAt: true, emailVerifiedAt: true, isActive: true, createdAt: true } as const

export function customerWhere(f: CustomerFilters): Prisma.UserWhereInput {
  const q = (f.q ?? '').trim().slice(0, 100)
  const digits = q.replace(/\D/g, '').replace(/^0+/, '') // "0812-345" cocok dengan E.164 tersimpan "62812345…"
  const search: Prisma.UserWhereInput[] = q ? [
    { fullName: { contains: escapeLike(q), mode: 'insensitive' } },
    { email: { contains: escapeLike(q), mode: 'insensitive' } },
    { phone: { contains: escapeLike(q) } },
    { whatsapp: { contains: escapeLike(q) } },
    ...(digits.length >= 4 ? [{ phone: { contains: digits } }, { whatsapp: { contains: digits } }] : []),
  ] : []
  return {
    role: 'pilgrim',
    ...(f.active ? { isActive: f.active === 'active' } : {}),
    ...(f.email ? { emailVerifiedAt: f.email === 'verified' ? { not: null } : null } : {}),
    ...(f.bookings ? { bookings: f.bookings === 'with' ? { some: {} } : { none: {} } } : {}),
    ...(search.length > 0 ? { OR: search } : {}),
  }
}

/** Jumlah pesanan dan total dibayar untuk sekumpulan akun (satu kueri; `ids` ≤ ukuran halaman). */
async function aggregates(ids: string[]): Promise<Map<string, { bookingCount: number; paidIdr: number }>> {
  const out = new Map<string, { bookingCount: number; paidIdr: number }>()
  if (ids.length === 0) return out
  // SQL mentah: Prisma ORM tak bisa menjumlah relasi bersarang (booking → payments) per pengguna dalam satu kueri; ber-parameter penuh.
  const rows = await prisma.$queryRaw<Array<{ userId: string; bookingCount: number; paid: string | null }>>(Prisma.sql`
    SELECT b."userId" AS "userId",
           COUNT(DISTINCT b."id")::int AS "bookingCount",
           COALESCE(SUM(p."amount") FILTER (WHERE p."status" = 'confirmed'), 0)::text AS "paid"
    FROM "bookings" b
    LEFT JOIN "payments" p ON p."bookingId" = b."id"
    WHERE b."userId" IN (${Prisma.join(ids)})
    GROUP BY b."userId"`)
  for (const r of rows) out.set(r.userId, { bookingCount: r.bookingCount, paidIdr: Number(r.paid ?? 0) })
  return out
}

export async function listCustomers(filters: CustomerFilters, list: ListParams): Promise<{ items: CustomerRow[]; meta: PageMeta }> {
  const where = customerWhere(filters)
  const { items, meta } = await paginate(
    list,
    () => prisma.user.count({ where }),
    range => prisma.user.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...range, select: LIST_SELECT }),
  )
  const agg = await aggregates(items.map(u => u.id))
  return {
    meta,
    items: items.map(u => ({
      id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, whatsapp: u.whatsapp,
      whatsappVerified: u.whatsappVerifiedAt !== null, emailVerified: u.emailVerifiedAt !== null, isActive: u.isActive, createdAt: u.createdAt,
      deleted: isDeletedAccount(u.email),
      bookingCount: agg.get(u.id)?.bookingCount ?? 0, paidIdr: agg.get(u.id)?.paidIdr ?? 0,
    })),
  }
}

export type CustomerDetail = CustomerRow & {
  emailVerifiedAt: Date | null
  whatsappVerifiedAt: Date | null
  /** Hanya penanda: nilai `googleSub` tak pernah dibaca. */
  googleLinked: boolean
  /** Pelonggaran aturan visa (D5): boleh pesan visa tanpa pesawat dan hotel. */
  allowVisaWithoutBundle: boolean
  /** Alamat rumah dirangkai satu baris; null = belum diisi. */
  address: string | null
  bookings: Array<{ id: string; bookingCode: string; status: DisplayStatus; departureDate: Date | null; totalAmount: number; createdAt: Date }>
  /** Paginasi daftar pesanan (total = SEMUA pesanan akun ini). */
  bookingsMeta: PageMeta
  payments: { confirmedIdr: number; confirmedCount: number; pendingCount: number; rejectedCount: number }
}

export const CUSTOMER_BOOKINGS_PAGE_SIZE = 10

export async function getCustomer(id: string, bookingList: ListParams = { page: 1, limit: CUSTOMER_BOOKINGS_PAGE_SIZE, skip: 0 }): Promise<CustomerDetail | null> {
  const u = await prisma.user.findFirst({
    where: { id, role: 'pilgrim' },
    select: {
      ...LIST_SELECT,
      googleSub: true, // hanya dipakai untuk `!== null` di bawah — tak pernah dikembalikan
      allowVisaWithoutBundle: true,
      address: { select: {
        type: true, fullAddress: true, postalCode: true, countryCode: true, city: true, stateRegion: true,
        village: { select: { name: true } }, district: { select: { name: true } }, regency: { select: { name: true } }, province: { select: { name: true } },
      } },
    },
  })
  if (!u) return null
  const [bookingsPage, payments, agg] = await Promise.all([
    paginate(
      bookingList,
      () => prisma.booking.count({ where: { userId: id } }),
      range => prisma.booking.findMany({
        where: { userId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...range,
        select: { id: true, bookingCode: true, totalAmount: true, createdAt: true, ...statusSelect },
      }),
    ),
    prisma.payment.groupBy({ by: ['status'], where: { booking: { userId: id } }, _count: true, _sum: { amount: true } }),
    aggregates([id]),
  ])
  const pay = (s: string) => payments.find(p => p.status === s)
  const a = u.address
  const address = !a ? null : (a.type === 'domestic'
    ? [a.fullAddress, a.village?.name, a.district?.name, a.regency?.name, a.province?.name, a.postalCode].filter(Boolean).join(', ')
    : [a.fullAddress, a.city, a.stateRegion, a.postalCode, getCountryName(a.countryCode ?? '')].filter(Boolean).join(', '))
  return {
    id: u.id, fullName: u.fullName, email: u.email, phone: u.phone, whatsapp: u.whatsapp,
    whatsappVerified: u.whatsappVerifiedAt !== null, emailVerified: u.emailVerifiedAt !== null, isActive: u.isActive, createdAt: u.createdAt,
    deleted: isDeletedAccount(u.email), emailVerifiedAt: u.emailVerifiedAt, whatsappVerifiedAt: u.whatsappVerifiedAt, googleLinked: u.googleSub !== null,
    allowVisaWithoutBundle: u.allowVisaWithoutBundle,
    address,
    bookingCount: agg.get(id)?.bookingCount ?? 0, paidIdr: agg.get(id)?.paidIdr ?? 0,
    bookings: bookingsPage.items.map(b => ({ id: b.id, bookingCode: b.bookingCode, status: displayStatusOf(b), departureDate: b.departureDate, totalAmount: Number(b.totalAmount), createdAt: b.createdAt })), bookingsMeta: bookingsPage.meta,
    payments: { confirmedIdr: Number(pay('confirmed')?._sum.amount ?? 0), confirmedCount: pay('confirmed')?._count ?? 0, pendingCount: pay('pending')?._count ?? 0, rejectedCount: pay('rejected')?._count ?? 0 },
  }
}
