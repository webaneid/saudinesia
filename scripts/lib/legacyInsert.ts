import type { PrismaClient } from '@prisma/client'

// Baris uji untuk DB PRA-migrasi (pola scripts/lib/legacyUser.ts). Klien Prisma proyek mengikuti skema TERBARU dan ikut mengirim nilai bawaan kolom baru saat INSERT
// (mis. `quotaConfirmed` pada tabel item booking), sehingga `db.<model>.create` gagal di DB yang belum punya kolom itu. INSERT mentah ini HANYA mengirim kolom yang disebut.
// Nama tabel/kolom berasal dari kode uji (bukan masukan pengguna) dan dikutip; nilai selalu parameter.
export async function legacyInsert(db: PrismaClient, table: string, data: Record<string, unknown>): Promise<{ id: string }> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`nama tabel tidak sah: ${table}`)
  const cols = Object.keys(data)
  if (cols.some(c => !/^[A-Za-z]+$/.test(c))) throw new Error('nama kolom tidak sah')
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO "${table}" (id, ${cols.map(c => `"${c}"`).join(', ')}) VALUES (gen_random_uuid(), ${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    ...cols.map(c => data[c]),
  )
  return rows[0]!
}
