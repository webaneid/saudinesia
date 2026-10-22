import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashToken } from '@/lib/auth/tokens'

// Verifikasi nomor WhatsApp lewat pesan MASUK (ADR-0002, docs/arsitektur-whatsapp-verifikasi.md §3). Hanya DB + fungsi murni — tanpa HTTP —
// supaya aturan keamanannya bisa diuji langsung.
//
// Pengguna mengirim `VERIF <KODE>` dari nomornya ke nomor bisnis; webhook GOWA memanggil completeWhatsappVerification() dengan JID pengirim.
// JID diautentikasi oleh WhatsApp (tak bisa dipalsukan pengguna) → membuktikan pengendalian nomor tanpa mengirim apa pun KELUAR dari kita.

/** Tanpa karakter yang mudah tertukar (I, L, O, 0, 1) — kode diketik/dibaca manusia. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
export const VERIFICATION_TTL_MS = 15 * 60 * 1000

export function generateCode(): string {
  let c = ''
  for (let i = 0; i < CODE_LENGTH; i++) c += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return c
}

/** Huruf besar, buang spasi/strip; tolak bila bukan 8 karakter dari alfabet kode. */
export function normalizeCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '')
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null
}

/** Pesan harus PERSIS `VERIF <KODE>` (atau `VERIFIKASI`) — teks lain diabaikan (webhook menerima SEMUA pesan masuk). */
export function parseVerificationMessage(body: unknown): string | null {
  if (typeof body !== 'string' || body.length > 64) return null
  const m = /^\s*VERIF(?:IKASI)?[\s:]+([A-Za-z0-9\s-]{8,14})\s*$/i.exec(body)
  return m?.[1] ? normalizeCode(m[1]) : null
}

/** JID pribadi `628…@s.whatsapp.net` (boleh bersufiks perangkat `:12`) → digit. LID/grup/lainnya → null (tak bisa dipetakan ke nomor). */
export function jidToDigits(jid: unknown): string | null {
  if (typeof jid !== 'string') return null
  const m = /^(\d{8,15})(?::\d+)?@s\.whatsapp\.net$/.exec(jid)
  return m?.[1] ?? null
}

/** `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256 atas body MENTAH dengan secret webhook. Perbandingan waktu-konstan. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header) return false
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())
  if (!m?.[1]) return false
  const expected = createHmac('sha256', secret).update(rawBody).digest()
  return timingSafeEqual(expected, Buffer.from(m[1], 'hex'))
}

// ───────────── permintaan kode ─────────────

export type VerificationRequest =
  | { ok: true; code: string; expiresAt: Date }
  | { ok: false; reason: 'not_found' | 'no_number' | 'already_verified' }

export async function requestWhatsappVerification(userId: string): Promise<VerificationRequest> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { whatsapp: true, verifiedWhatsapp: true } })
  if (!user) return { ok: false, reason: 'not_found' }
  if (!user.whatsapp) return { ok: false, reason: 'no_number' }
  if (user.verifiedWhatsapp === user.whatsapp) return { ok: false, reason: 'already_verified' }

  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode()
    const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS)
    try {
      await prisma.$transaction([
        // Kode lama yang belum dipakai dihanguskan — hanya kode terbaru yang berlaku.
        prisma.authToken.deleteMany({ where: { userId, type: 'whatsapp_verification', usedAt: null } }),
        prisma.authToken.create({
          data: { type: 'whatsapp_verification', tokenHash: hashToken(code), userId, payload: { whatsapp: user.whatsapp }, expiresAt },
        }),
      ])
      return { ok: true, code, expiresAt }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue // tabrakan kode (sangat jarang) → ulangi
      throw e
    }
  }
  throw new Error('gagal menerbitkan kode unik')
}

// ───────────── penyelesaian (dipanggil webhook) ─────────────

export type VerificationResult = { ok: true; userId: string; email: string } | { ok: false; reason: 'invalid' | 'mismatch' | 'taken' }

/**
 * Syarat sah: kode berlaku (belum dipakai/kedaluwarsa) DAN pengirim pesan == nomor yang dikunci pada kode DAN == nomor akun saat ini.
 * Kode tidak dihanguskan pada ketidakcocokan (hanya pada keberhasilan), jadi pesan dari nomor lain tak bisa "membakar" kode pengguna sah.
 * Nomor yang sudah terverifikasi di akun LAIN ditolak ('taken') dan transaksi di-rollback.
 */
export async function completeWhatsappVerification(input: { code: string; senderDigits: string }): Promise<VerificationResult> {
  const code = normalizeCode(input.code)
  if (!code) return { ok: false, reason: 'invalid' }

  try {
    return await prisma.$transaction(async (tx) => {
      const t = await tx.authToken.findUnique({ where: { tokenHash: hashToken(code) } })
      if (!t || t.type !== 'whatsapp_verification' || t.usedAt || t.expiresAt <= new Date() || !t.userId) return { ok: false as const, reason: 'invalid' as const }

      const locked = (t.payload as { whatsapp?: unknown } | null)?.whatsapp
      const user = await tx.user.findUnique({ where: { id: t.userId }, select: { id: true, isActive: true, whatsapp: true, email: true } })
      if (!user || !user.isActive) return { ok: false as const, reason: 'invalid' as const }
      if (locked !== input.senderDigits || user.whatsapp !== input.senderDigits) return { ok: false as const, reason: 'mismatch' as const }

      const claimed = await tx.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } })
      if (claimed.count !== 1) return { ok: false as const, reason: 'invalid' as const }

      // Tulis BERSYARAT: nomor akun harus masih sama saat ini juga (pembacaan di atas tak terkunci — updateContact bisa mengganti nomor di antaranya;
      // tanpa syarat ini akan tertinggal verifiedWhatsapp basi). Tak cocok → rollback agar kode tidak terbakar.
      // P2002 (verifiedWhatsapp unik) = nomor sudah terverifikasi di akun lain → exception → rollback → 'taken'.
      const written = await tx.user.updateMany({
        where: { id: user.id, isActive: true, whatsapp: input.senderDigits },
        data: { whatsappVerifiedAt: new Date(), verifiedWhatsapp: input.senderDigits },
      })
      if (written.count !== 1) throw new RaceLost()
      return { ok: true as const, userId: user.id, email: user.email }
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: false, reason: 'taken' }
    if (e instanceof RaceLost) return { ok: false, reason: 'mismatch' }
    throw e
  }
}

/** Nomor akun berganti persis di antara pembacaan dan penulisan: transaksi di-rollback (kode tidak terbakar). */
class RaceLost extends Error {}
