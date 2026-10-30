import type { Address, InvoiceSettings } from '@prisma/client'
import { prisma } from '@/lib/db'
import { upsertAddress } from '@/lib/address/prepare'
import { isValidTimezone, setAppTimezone } from '@/lib/time'
import { changedFields, writeAudit } from '@/lib/invoice/audit'
import type { InvoiceSettingsInput } from '@/lib/validators/invoiceSettings'

// Pengaturan Invoice (docs/arsitektur-booking-engine-v2.md §6): SATU baris 'global'. Pembaca/penulis tunggal — halaman, penerbitan invoice, dan halaman bayar membaca lewat sini.
export const SETTINGS_ID = 'global'

type Row = InvoiceSettings & { companyAddress: Address | null }
export type InvoiceSettingsDto = Omit<Row, 'minimumFirstPaymentPercent' | 'ipaymuFeePercent' | 'xenditFeePercent' | 'updatedAt'> & {
  minimumFirstPaymentPercent: number; ipaymuFeePercent: number; xenditFeePercent: number; updatedAt: string
}

const toDto = (r: Row): InvoiceSettingsDto => ({
  ...r,
  minimumFirstPaymentPercent: Number(r.minimumFirstPaymentPercent), ipaymuFeePercent: Number(r.ipaymuFeePercent), xenditFeePercent: Number(r.xenditFeePercent),
  updatedAt: r.updatedAt.toISOString(),
})

/** Baris 'global' selalu ada (migrasi menyemainya); upsert defensif untuk database yang dibuat tanpa migrasi (mis. uji). */
export async function getInvoiceSettings(): Promise<InvoiceSettingsDto> {
  const row = await prisma.invoiceSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {}, include: { companyAddress: true } })
  return toDto(row)
}

/**
 * Muat zona waktu aplikasi dari setelan (dipanggil saat boot). Galat database (mis. DB belum siap saat web naik) DICOBA ULANG; nilai tak dikenal/baris tak ada → `null` tanpa ulang
 * (zona bawaan tetap). Tak melempar (SEC-110).
 */
export async function loadAppTimezone(opts: { attempts?: number; delayMs?: number } = {}): Promise<string | null> {
  const attempts = opts.attempts ?? 5
  const delayMs = opts.delayMs ?? 3000
  for (let i = 1; i <= attempts; i++) {
    try {
      const row = await prisma.invoiceSettings.findUnique({ where: { id: SETTINGS_ID }, select: { appTimezone: true } })
      if (row && isValidTimezone(row.appTimezone)) { setAppTimezone(row.appTimezone); return row.appTimezone }
      return null
    } catch (e) {
      console.error(`[waktu] gagal memuat zona aplikasi (percobaan ${i}/${attempts}):`, e instanceof Error ? e.message : String(e))
      if (i < attempts) await new Promise(r => setTimeout(r, delayMs))
    }
  }
  return null
}

export class SettingsError extends Error {
  constructor(public status: 400 | 409, message: string) { super(message); this.name = 'SettingsError' }
}

const LONG_TEXT = ['termsDoc', 'footerNoteDoc'] as const

/**
 * Simpan pengaturan — SATU transaksi dengan kunci baris (dua penyimpan serentak diserialkan; alamat baru tak yatim, SEC-117):
 *  • `expectedUpdatedAt` basi → 409 (tak menimpa perubahan orang lain);
 *  • mengubah "urut diulang tiap tahun" setelah ada nomor terbit → 409 (dua aliran penghitung akan menerbitkan nomor kembar, SEC-108);
 *  • zona waktu harus dikenal DATABASE juga (`pg_timezone_names`) — laporan memakainya di SQL (SEC-114);
 *  • `address`: undefined = tak diubah, null = hapus alamat, objek = buat/ubah;
 *  • jejak (siapa/apa yang berubah) ditulis di transaksi yang sama (SEC-109).
 * Zona waktu aplikasi proses ini diperbarui setelah commit.
 */
export async function updateInvoiceSettings(input: InvoiceSettingsInput, staffId: string): Promise<InvoiceSettingsDto> {
  const { address, expectedUpdatedAt, ...fields } = input
  await prisma.invoiceSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID }, update: {} })

  const row = await prisma.$transaction(async tx => {
    // $queryRaw: Prisma ORM tidak punya SELECT … FOR UPDATE.
    await tx.$queryRaw`SELECT 1 FROM invoice_settings WHERE id = ${SETTINGS_ID} FOR UPDATE`
    const cur = await tx.invoiceSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID }, include: { companyAddress: true } })

    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== cur.updatedAt.getTime()) {
      throw new SettingsError(409, 'Pengaturan sudah diubah oleh orang lain. Muat ulang halaman, lalu ulangi perubahan Anda.')
    }
    if (fields.numberResetYearly !== cur.numberResetYearly && (await tx.invoiceSequence.count()) > 0) {
      throw new SettingsError(409, 'Nomor invoice sudah pernah diterbitkan — pengaturan "urut diulang tiap tahun" tidak dapat diubah (dua aliran nomor akan menghasilkan nomor kembar). Ubah awalan atau pola jika perlu.')
    }
    if (fields.appTimezone !== cur.appTimezone) {
      const known = await tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_timezone_names WHERE name = ${fields.appTimezone}`
      if (!known[0] || known[0].n === 0) throw new SettingsError(400, 'Zona waktu tidak dikenal oleh database')
    }

    let addressId: string | null | undefined
    if (address === null) addressId = null
    else if (address !== undefined) {
      const r = await upsertAddress(cur.companyAddressId, address, tx)
      if (!r.ok) throw new SettingsError(400, r.message)
      addressId = r.id
    }

    const updated = await tx.invoiceSettings.update({
      where: { id: SETTINGS_ID },
      data: { ...fields, ...(addressId !== undefined ? { companyAddressId: addressId } : {}), updatedById: staffId },
      include: { companyAddress: true },
    })
    if (address === null && cur.companyAddressId) await tx.address.delete({ where: { id: cur.companyAddressId } }) // alamat yang dilepas tak dibiarkan yatim

    const before: Record<string, unknown> = { ...cur, minimumFirstPaymentPercent: Number(cur.minimumFirstPaymentPercent), ipaymuFeePercent: Number(cur.ipaymuFeePercent), xenditFeePercent: Number(cur.xenditFeePercent) }
    const diff = changedFields(before, fields as Record<string, unknown>, LONG_TEXT)
    if (address !== undefined) diff.address = address === null ? 'dihapus' : cur.companyAddressId ? 'diubah' : 'dibuat'
    if (Object.keys(diff).length > 0) await writeAudit(tx, staffId, 'invoice_settings', SETTINGS_ID, 'update', diff)
    return updated
  })
  setAppTimezone(row.appTimezone)
  return toDto(row)
}
