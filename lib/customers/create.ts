import { randomBytes } from 'node:crypto'
import { hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { INVITATION_TTL_MS, discardToken, issueToken, supersedeOlderTokens } from '@/lib/auth/tokens'
import { sendAuthEmail } from '@/lib/auth/authEmail'
import { prepareAddressData } from '@/lib/address/prepare'
import type { CustomerCreateInput } from '@/lib/validators/customers'

// Tambah pelanggan oleh admin (docs/arsitektur-pelanggan.md §6). Akun lahir BELUM DIAKTIFKAN: password acak yang tak diketahui siapa pun dan `emailVerifiedAt` kosong,
// sehingga tak bisa login sampai PEMILIK email membuat password lewat tautan undangan (alur reset-password yang sudah ada, yang sekaligus membuktikan kepemilikan email).
// Persetujuan UU PDP TIDAK dicatat di sini — pelanggan menyetujuinya sendiri pada langkah "Lengkapi data" setelah aktivasi.

const BCRYPT_COST = 12

export type InviteStatus = 'sent' | 'skipped' | 'failed' | 'none'

export type CreateCustomerResult =
  | { ok: true; id: string; fullName: string; email: string }
  | { ok: false; status: 400 | 409; message: string }

export async function createCustomer(input: CustomerCreateInput): Promise<CreateCustomerResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })
  if (existing) return { ok: false, status: 409, message: 'Email ini sudah terdaftar sebagai akun.' }

  // Hierarki wilayah divalidasi server-side (bukan percaya urutan klik di UI).
  let addressData: Prisma.AddressUncheckedCreateInput | null = null
  if (input.address) {
    const prepared = await prepareAddressData(input.address)
    if (!prepared.ok) return { ok: false, status: 400, message: prepared.message }
    addressData = prepared.data
  }

  // Password acak 256-bit yang langsung dibuang: akun tak bisa dimasuki lewat password sampai pemiliknya membuat sendiri (resetPassword).
  const passwordHash = await hash(randomBytes(32).toString('base64url'), BCRYPT_COST)

  try {
    const user = await prisma.$transaction(async tx => {
      const address = addressData ? await tx.address.create({ data: addressData, select: { id: true } }) : null
      return tx.user.create({
        data: {
          email: input.email, passwordHash, fullName: input.fullName,
          phone: input.phone ?? null, whatsapp: input.whatsapp ?? null,
          role: 'pilgrim', isActive: true, emailVerifiedAt: null, addressId: address?.id ?? null,
        },
        select: { id: true, fullName: true, email: true },
      })
    })
    return { ok: true, id: user.id, fullName: user.fullName, email: user.email }
  } catch (e) {
    // Dua admin menambah email yang sama bersamaan / pendaftaran mandiri menyalip: transaksi di-rollback (alamat ikut batal).
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, status: 409, message: 'Email ini sudah terdaftar sebagai akun.' }
    throw e
  }
}

export type InviteResult =
  | { ok: true; status: Exclude<InviteStatus, 'none'> }
  | { ok: false; status: 404 | 409; message: string }

type Invitable = { id: string; fullName: string; email: string }

/** Kelayakan undangan: pilgrim aktif yang BELUM diaktifkan pemiliknya (dan bukan akun anonim). Dicek SEBELUM kuota email apa pun dikonsumsi (audit: kuota per alamat tak boleh habis oleh permintaan yang akan ditolak). */
export async function findInvitable(userId: string): Promise<{ ok: true; user: Invitable } | { ok: false; status: 404 | 409; message: string }> {
  const user = await prisma.user.findFirst({ where: { id: userId, role: 'pilgrim' }, select: { id: true, fullName: true, email: true, isActive: true, emailVerifiedAt: true } })
  if (!user) return { ok: false, status: 404, message: 'Pelanggan tidak ditemukan.' }
  // Akun anonim (UU PDP) sudah nonaktif — cek DULU supaya pesannya benar, bukan "aktifkan dulu".
  if (user.email.startsWith('deleted-') && user.email.endsWith('@deleted.invalid')) return { ok: false, status: 409, message: 'Akun ini sudah dihapus.' }
  if (user.emailVerifiedAt) return { ok: false, status: 409, message: 'Akun ini sudah diaktifkan oleh pemiliknya.' }
  if (!user.isActive) return { ok: false, status: 409, message: 'Akun ini dinonaktifkan — aktifkan dulu di Sistem → Pengguna.' }
  return { ok: true, user }
}

/**
 * Terbitkan token baru dan kirim emailnya. Tautan lama HANYA dihanguskan bila email baru benar-benar terkirim: kirim ulang yang gagal/dilewati membuang token barunya
 * dan membiarkan tautan lama tetap berfungsi (SEC-106). Di development (tautan dicetak ke log server) token baru dipertahankan dan yang lama tetap dihanguskan.
 * Token tak pernah keluar dari server selain lewat email.
 */
export async function sendInvitation(user: Invitable): Promise<Exclude<InviteStatus, 'none'>> {
  const token = await issueToken({ type: 'password_reset', userId: user.id, ttlMs: INVITATION_TTL_MS }, { keepExisting: true })
  const result = await sendAuthEmail('account_invitation', user.email, { name: user.fullName, locale: 'id', token })
  if (result.status === 'sent' || process.env.NODE_ENV === 'development') await supersedeOlderTokens(token)
  else await discardToken(token)
  return result.status
}

/** Kirim (atau kirim ulang) undangan aktivasi. */
export async function inviteCustomer(userId: string): Promise<InviteResult> {
  const found = await findInvitable(userId)
  if (!found.ok) return found
  return { ok: true, status: await sendInvitation(found.user) }
}
