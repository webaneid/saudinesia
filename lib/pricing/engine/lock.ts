import type { Prisma } from '@prisma/client'

/** Kunci semua titik harga milik pemilik (serialkan hitung-ulang dan perubahan harga manual agar tak saling menimpa). */
export async function lockOwnerPoints(tx: Prisma.TransactionClient, ownerType: string, ownerId: string): Promise<void> {
  // $queryRaw: Prisma ORM tidak punya `SELECT … FOR UPDATE`. Tanpa kunci ini hitung-ulang yang membaca baris lebih dulu menimpa harga manual yang baru commit.
  await tx.$queryRaw`SELECT "id" FROM "price_points" WHERE "ownerType" = ${ownerType} AND "ownerId" = ${ownerId} ORDER BY "id" FOR UPDATE`
}
