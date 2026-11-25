import type { Prisma } from '@prisma/client'
import { activeFields, pilgrimCatalog } from '@/lib/pilgrim-data/catalog'
import { isSealedRole, snapshotFromCard } from '@/lib/manifest/roles'
import { isEmptyValue } from '@/lib/manifest/values'
import { cardSelect, forSnapshot, sealedColumns, type CardRow } from './cardSnapshot'

// Kartu diubah → jamaah booking tertaut yang BELUM diajukan ikut (docs/arsitektur-data-jamaah.md §14). Dipanggil layanan kartu di dalam
// transaksinya, sesudah kartu ditulis. Booking tidak aktif dan jamaah diajukan/terverifikasi tetap beku.
// Per kolom: yang BERUBAH di kartu menimpa booking; yang tak berubah hanya mengisi kolom booking yang kosong — isian petugas di booking
// tidak terhapus hanya karena kolom itu kosong di kartu. NIK/paspor: bila kartu punya, booking = kartu (segel disalin apa adanya, tanpa
// membuka — samaran yang sama bisa berarti nomor berbeda); dihapus di kartu → dihapus; tak pernah ada di kartu → segel booking dibiarkan.

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Aturan gabung (murni, diuji): `before`/`after` = snapshot kartu, `current` = isian booking. */
export function mergeCardChange(
  fields: readonly { fieldKey: string; role: string | null }[],
  before: Record<string, unknown>, after: Record<string, unknown>, current: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...current }
  for (const f of fields) {
    const k = f.fieldKey
    if (!(k in after)) continue
    if ((isSealedRole(f.role) && !isEmptyValue(after[k])) || !same(before[k], after[k]) || isEmptyValue(current[k])) out[k] = after[k] ?? null
  }
  return out
}

export async function syncLinkedPilgrims(tx: Prisma.TransactionClient, cardId: string, before: CardRow): Promise<number> {
  // $queryRaw: Prisma ORM tidak punya SELECT ... FOR UPDATE. Status dinilai ulang sesudah menunggu kunci (pengajuan serentak menang).
  const rows = await tx.$queryRaw<{ id: string; fieldValues: unknown }[]>`
    SELECT bp."id", bp."fieldValues" FROM "booking_pilgrims" bp JOIN "bookings" b ON b."id" = bp."bookingId"
    WHERE bp."savedPilgrimId" = ${cardId} AND bp."reviewStatus" IN ('draft', 'needs_revision') AND b."status" = 'active'
    ORDER BY bp."id" FOR UPDATE OF bp`
  if (rows.length === 0) return 0
  const card = await tx.savedPilgrim.findUniqueOrThrow({ where: { id: cardId }, select: cardSelect })
  const fields = activeFields(await pilgrimCatalog(tx))
  const was = snapshotFromCard(fields, forSnapshot(before))
  const now = snapshotFromCard(fields, forSnapshot(card))
  for (const r of rows) {
    await tx.bookingPilgrim.update({
      where: { id: r.id },
      data: {
        identityId: card.identityId,
        fieldValues: mergeCardChange(fields, was, now, (r.fieldValues ?? {}) as Record<string, unknown>) as Prisma.InputJsonValue,
        ...sealedColumns(card, { nik: before.nikHash === null, passport: before.passportCipher === null }),
      },
      select: { id: true },
    })
  }
  return rows.length
}
