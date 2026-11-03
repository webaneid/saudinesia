import { requireSession } from '@/lib/auth/session'
import type { Actor } from './service'

/** Sesi jamaah pemilik daftar "Jamaah Saya". Staf → Forbidden: kartu pelanggan dikelola lewat route admin atas nama pelanggan. */
export async function requirePilgrimActor(): Promise<Actor> {
  const s = await requireSession()
  if (s.role !== 'pilgrim') throw new Error('Forbidden')
  return { userId: s.userId, role: s.role }
}
