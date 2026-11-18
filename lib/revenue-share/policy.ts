import { requireSuperAdmin, SUPERADMIN_ROLES, type SessionPayload } from '@/lib/auth/session'

// Peran pencairan bagi hasil (Fase 13e-1, docs/arsitektur-bagi-hasil.md §5e, Q3): uang keluar dari kas KLIEN → dicatat/dibatalkan superadmin klien,
// BUKAN akun Platform Provider (pemisahan tugas: penerima tak mencatat pembayaran untuk dirinya sendiri). Melihat: semua superadmin.
export const canRecordPayout = (s: Pick<SessionPayload, 'role' | 'isPlatformProvider'>): boolean => SUPERADMIN_ROLES.includes(s.role) && !s.isPlatformProvider

export async function requirePayoutRecorder(): Promise<SessionPayload> {
  const session = await requireSuperAdmin()
  if (!canRecordPayout(session)) throw new Error('Forbidden')
  return session
}
