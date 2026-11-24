// Nomor WhatsApp Saudinesia yang BENAR-BENAR tertaut lewat scan (Sistem → WhatsApp) — tujuan pesan verifikasi jamaah
// (docs/rencana-profil-jamaah.md P1). Bukan `NEXT_PUBLIC_BUSINESS_WA`: pesan ke nomor yang tak tertaut tidak pernah sampai ke webhook,
// jadi verifikasi tak akan pernah berhasil. Tak terhubung / webhook belum disetel → null = verifikasi sedang tidak tersedia.
import { whatsapp } from '@/lib/whatsapp/client'
import { webhookSecret } from '@/lib/whatsapp/webhook'

const CACHE_MS = 15_000
let cached: { at: number; number: string | null } | null = null
let pending: Promise<string | null> | null = null

async function read(): Promise<string | null> {
  if (webhookSecret() === null) return null
  const s = await whatsapp.status()
  return s.connected ? s.phone : null
}

/** Digit E.164 nomor tertaut, atau null. Di-cache sebentar dan satu pembacaan untuk banyak permintaan serentak (gateway tidak dibanjiri). */
export async function linkedWhatsappNumber(now: number = Date.now()): Promise<string | null> {
  if (cached && now - cached.at >= 0 && now - cached.at < CACHE_MS) return cached.number
  pending ??= read()
    .then(number => { cached = { at: now, number }; return number })
    .finally(() => { pending = null })
  return pending
}

/** Untuk uji: paksa baca ulang gateway. */
export function clearLinkedNumberCache(): void { cached = null }
