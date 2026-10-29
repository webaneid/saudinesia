import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/db'
import { PRIVACY_POLICY_VERSION, WHATSAPP_CONSENT_VERSION } from '@/lib/constants/legal'

// Data kontak akun (docs/arsitektur-auth.md §3.5). Telepon & WhatsApp: digit E.164, tidak diverifikasi, tidak unik.

export function isContactComplete(u: { phone: string | null; whatsapp: string | null }): boolean {
  return Boolean(u.phone && u.whatsapp)
}

/** Keadaan "langkah awal" jamaah (docs/arsitektur-auth.md §3.5; diperluas docs/arsitektur-pelanggan.md §6): kontak lengkap DAN dua persetujuan UU PDP tercatat. */
export type OnboardingState = { phone: string | null; whatsapp: string | null; contactComplete: boolean; whatsappConsent: boolean; privacyConsent: boolean }

export async function getOnboardingState(userId: string): Promise<OnboardingState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phone: true, whatsapp: true, consentLogs: { where: { type: { in: ['whatsapp_notifications', 'privacy_policy'] } }, select: { type: true } } },
  })
  if (!user) return null
  const has = (t: string) => user.consentLogs.some(c => c.type === t)
  return { phone: user.phone, whatsapp: user.whatsapp, contactComplete: isContactComplete(user), whatsappConsent: has('whatsapp_notifications'), privacyConsent: has('privacy_policy') }
}

export const isOnboardingComplete = (s: OnboardingState): boolean => s.contactComplete && s.whatsappConsent && s.privacyConsent

/**
 * Penegakan di SERVER (gerbang UI saja tidak cukup): jamaah wajib melengkapi langkah awal (telepon + WhatsApp + persetujuan Kebijakan Privasi dan notifikasi
 * WhatsApp) sebelum membuat booking, karena notifikasi bergantung padanya. Akun buatan admin lahir tanpa persetujuan — pemiliknya menyetujui sendiri setelah aktivasi.
 * Staf tidak terkena. Dipanggil route `POST /bookings` SEBELUM membaca body / efek samping apa pun.
 */
export async function requireContactForBooking(userId: string, role: UserRole): Promise<boolean> {
  if (role !== 'pilgrim') return true
  const state = await getOnboardingState(userId)
  return Boolean(state && isOnboardingComplete(state))
}

export type ContactUpdate =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'consent_required' | 'not_found' }

/**
 * Simpan telepon + WhatsApp. Persetujuan notifikasi WhatsApp WAJIB diberikan sekali (dicatat di ConsentLog, UU PDP): bila akun belum
 * punya catatannya (mis. pengguna Google baru), `whatsappConsent` harus true; setelah itu pengubahan nomor tidak meminta ulang.
 * `changed` = nomor yang SUDAH ada berganti (pengisian pertama bukan perubahan) — pemanggil memberi tahu pemilik lewat email.
 */
export async function updateContact(userId: string, input: { phone: string; whatsapp: string; whatsappConsent?: boolean; privacyConsent?: boolean }): Promise<ContactUpdate> {
  return prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Kunci baris pengguna menserialkan dua pembaruan paralel milik akun yang
    // sama — tanpa ini dua PUT bersamaan sama-sama melihat "belum ada persetujuan" dan mencatatnya dua kali.
    const locked = await tx.$queryRaw<{ phone: string | null; whatsapp: string | null }[]>`SELECT "phone", "whatsapp" FROM "users" WHERE "id" = ${userId} FOR UPDATE`
    const before = locked[0]
    if (!before) return { ok: false as const, reason: 'not_found' as const }

    const consented = await tx.consentLog.findFirst({ where: { userId, type: 'whatsapp_notifications' }, select: { id: true } })
    if (!consented) {
      if (input.whatsappConsent !== true) return { ok: false as const, reason: 'consent_required' as const }
      await tx.consentLog.create({ data: { userId, type: 'whatsapp_notifications', version: WHATSAPP_CONSENT_VERSION } })
    }
    // Persetujuan Kebijakan Privasi (akun buatan admin lahir tanpanya): dicatat di transaksi yang SAMA dengan penyimpanan kontak dan di bawah kunci baris yang sama — tak ganda pada PUT paralel, tak setengah jadi.
    // HANYA atas tindakan pemilik akun (route memeriksa sesi dan `privacyConsent === true` sebelum sampai sini).
    if (input.privacyConsent === true && !(await tx.consentLog.findFirst({ where: { userId, type: 'privacy_policy' }, select: { id: true } }))) {
      await tx.consentLog.create({ data: { userId, type: 'privacy_policy', version: PRIVACY_POLICY_VERSION } })
    }
    // Nomor WhatsApp berganti → verifikasi dicabut (nomor baru harus dibuktikan lagi); telepon biasa tak memengaruhi.
    const whatsappChanged = before.whatsapp !== input.whatsapp
    await tx.user.update({
      where: { id: userId },
      data: { phone: input.phone, whatsapp: input.whatsapp, ...(whatsappChanged ? { whatsappVerifiedAt: null, verifiedWhatsapp: null } : {}) },
    })

    const changed = Boolean((before.phone && before.phone !== input.phone) || (before.whatsapp && before.whatsapp !== input.whatsapp))
    return { ok: true as const, changed }
  })
}
