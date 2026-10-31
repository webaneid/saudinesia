import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db'
import { requireJwtSecret } from '@/lib/auth/secret'
import { appUrl } from '@/lib/email/templates'

// Tautan invoice publik (docs/arsitektur-booking-engine-v2.md §10.4 6c, K6): `<invoiceId tanpa tanda hubung>.<HMAC-SHA256(invoiceId:linkVersion)>` dengan kunci TURUNAN
// (bukan JWT_SECRET mentah — pola lib/auth/google.ts). Token TIDAK disimpan di DB; dicabut dengan menaikkan `Invoice.linkVersion` (lib/invoice/issue.ts).
// SATU-SATUNYA pembuat dan pemeriksa token: halaman/PDF publik dan tombol admin memakai fungsi ini.

const LABEL = 'invoice-link'
const key = () => createHash('sha256').update(`${LABEL}:${requireJwtSecret()}`).digest()
const mac = (invoiceId: string, version: number) => createHmac('sha256', key()).update(`${invoiceId}:${version}`).digest()
const TOKEN_RE = /^([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/

/** Token tautan untuk versi tautan TERKINI invoice. */
export function invoiceLinkToken(invoice: { id: string; linkVersion: number }): string {
  return `${invoice.id.replace(/-/g, '')}.${mac(invoice.id, invoice.linkVersion).toString('base64url')}`
}

/** URL absolut tautan (`APP_URL`); kosong bila APP_URL tak diisi di luar development (pemanggil memutuskan). */
export function invoiceLinkUrl(token: string, locale = 'id'): string {
  const base = appUrl()
  return base ? `${base}/${locale}/invoice/${token}` : ''
}

const uuidOf = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

/**
 * Periksa token → id booking yang invoicenya boleh ditampilkan, atau `null` (format rusak / tak ada / sudah dicabut / booking draf) — pemanggil menjawab SERAGAM 404.
 * Perbandingan waktu-konstan; tak ada pesan yang membedakan alasan penolakan.
 */
export async function resolveInvoiceToken(token: string): Promise<{ bookingId: string; invoiceId: string } | null> {
  const m = TOKEN_RE.exec(token)
  if (!m) return null
  const invoiceId = uuidOf(m[1]!)
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, linkVersion: true, bookingId: true, booking: { select: { status: true } } } })
  if (!inv || inv.booking.status === 'draft') return null
  const given = Buffer.from(m[2]!, 'base64url')
  if (given.toString('base64url') !== m[2]) return null // hanya bentuk KANONIK (karakter terakhir base64url membawa 4 bit; 4 ejaan → satu MAC)
  const expected = mac(inv.id, inv.linkVersion)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  return { bookingId: inv.bookingId, invoiceId: inv.id }
}

/** Bentuk token benar (bukan bukti keabsahan) — pemuat publik menghitung batas laju per token hanya untuk token berbentuk benar. */
export const isTokenShaped = (token: string) => TOKEN_RE.test(token)

/** Samarkan tautan invoice dalam teks yang disimpan (log notifikasi) — token adalah kredensial pembaca. */
export const redactInvoiceLinks = (text: string) => text.replace(/\/invoice\/[0-9a-f]{32}\.[A-Za-z0-9_-]{43}/g, '/invoice/[tautan]')
