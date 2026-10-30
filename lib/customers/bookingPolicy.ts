import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { writeAudit } from '@/lib/invoice/audit'
import { isDeletedAccount } from './query'
import type { CustomerPolicyInput } from '@/lib/validators/customers'

// SATU penulis `User.allowVisaWithoutBundle` (docs/arsitektur-booking-engine-v2.md D5, §10.2): pelonggaran aturan visa per pelanggan. Setiap perubahan tercatat
// append-only di `settings_audit` (entity `customer_policy`) di transaksi yang sama — tanpa jejak, perubahan ikut batal. Tidak menyentuh sesi (bukan peran/password).

export type PolicyResult = { ok: true; changed: boolean } | { ok: false; status: 404 | 409; message: string }

export async function setCustomerBookingPolicy(customerId: string, input: CustomerPolicyInput, staffId: string): Promise<PolicyResult> {
  return prisma.$transaction(async (tx) => {
    // $queryRaw: Prisma ORM tak punya SELECT … FOR UPDATE — dua perubahan serentak dicatat berurutan dengan nilai "sebelum" yang benar.
    const rows = await tx.$queryRaw<Array<{ role: string; email: string; allowVisaWithoutBundle: boolean }>>(
      Prisma.sql`SELECT "role", "email", "allowVisaWithoutBundle" FROM "users" WHERE "id" = ${customerId} FOR UPDATE`,
    )
    const u = rows[0]
    if (!u || u.role !== 'pilgrim') return { ok: false as const, status: 404 as const, message: 'Pelanggan tidak ditemukan' }
    if (isDeletedAccount(u.email)) return { ok: false as const, status: 409 as const, message: 'Akun ini sudah dihapus' }
    if (u.allowVisaWithoutBundle === input.allowVisaWithoutBundle) return { ok: true as const, changed: false }
    await tx.user.update({ where: { id: customerId }, data: { allowVisaWithoutBundle: input.allowVisaWithoutBundle } })
    await writeAudit(tx, staffId, 'customer_policy', customerId, 'update', { allowVisaWithoutBundle: [u.allowVisaWithoutBundle, input.allowVisaWithoutBundle] })
    return { ok: true as const, changed: true }
  })
}
