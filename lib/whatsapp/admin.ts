// Panel Sistem → WhatsApp (docs/rencana-gowa-self-host.md §4.1, keputusan K3/K5/K6) — superadmin saja (penjaga di route).
// Semua panggilan GOWA tetap lewat lib/whatsapp/client.ts; modul ini menyusun status panel, kirim uji ke nomor staf sendiri, dan jejak.
// Jejak = settings_audit (entity `whatsapp`) TANPA nomor telepon di ringkasan.
import { prisma } from '@/lib/db'
import { writeAudit, type AuditAction } from '@/lib/invoice/audit'
import { businessWaDigits } from '@/lib/constants/payment'
import { webhookSecret } from '@/lib/whatsapp/webhook'
import { whatsapp, gatewayConfigured } from '@/lib/whatsapp/client'
import type { WhatsappPanelStatus } from '@/lib/validators/whatsapp'

export async function panelStatus(): Promise<WhatsappPanelStatus> {
  const gateway = await whatsapp.status()
  const business = businessWaDigits() || null
  const cfg = gatewayConfigured()
  return {
    configured: cfg.url,
    credentials: cfg.credentials,
    webhookSecretSet: webhookSecret() !== null,
    businessNumber: business,
    gateway,
    numberMismatch: Boolean(gateway.connected && gateway.phone && business && gateway.phone !== business),
  }
}

type WaAction = Extract<AuditAction, `wa_${string}`>

/** Satu baris jejak per tindakan (berhasil atau tidak). Jejak gagal tidak boleh menggagalkan tindakan gateway yang SUDAH terjadi — dicatat di log saja oleh pemanggil. */
export async function recordWhatsappAction(staffId: string, action: WaAction, outcome: string): Promise<void> {
  await writeAudit(prisma, staffId, 'whatsapp', 'gateway', action, { outcome })
}

export const TEST_MESSAGE = 'Pesan uji dari panel admin Saudinesia: gateway WhatsApp berfungsi. Abaikan pesan ini.'

export type TestSendResult = { status: 'sent' } | { status: 'unverified' } | { status: 'failed' | 'skipped'; detail: string }

/**
 * Kirim uji HANYA ke nomor WhatsApp TERVERIFIKASI milik staf yang menekan (ADR-0002) — tak ada kotak nomor bebas, jadi panel ini tak bisa
 * dipakai mengirim ke orang lain.
 */
export async function sendTestToStaff(staffId: string): Promise<TestSendResult> {
  const me = await prisma.user.findUnique({ where: { id: staffId }, select: { whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true } })
  if (!me?.whatsapp || !me.whatsappVerifiedAt || me.verifiedWhatsapp !== me.whatsapp) return { status: 'unverified' }
  const r = await whatsapp.sendMessage({ phone: me.whatsapp, message: TEST_MESSAGE })
  if (r.status === 'sent') return { status: 'sent' }
  return r.status === 'skipped' ? { status: 'skipped', detail: r.reason } : { status: 'failed', detail: r.error }
}
