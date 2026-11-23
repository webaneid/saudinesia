import { prisma } from '@/lib/db'

// Pembantu UJI: atur katalog Data Jamaah global (pilgrim_fields) sesuai kebutuhan satu skrip lalu kembalikan persis seperti semula.
// Hanya untuk database uji (pemanggil sudah menjalankan assertThrowawayDb). Penulis sungguhan katalog = lib/pilgrim-data (D2).

export type TestField = { key: string; fieldType: string; required?: boolean; label?: string }

/**
 * Kolom sistem di `active` dinyalakan, kolom sistem lain dimatikan (`fullName` selalu aktif — CHECK DB); `custom` = kolom admin baru.
 * `required` kolom sistem dapat ditimpa lewat `requiredSystem`. Mengembalikan fungsi pemulih.
 */
export async function useTestCatalog(active: readonly string[], custom: readonly TestField[] = [], requiredSystem: Record<string, boolean> = {}) {
  const before = await prisma.pilgrimField.findMany({ select: { id: true, isActive: true, required: true } })
  const rows = await prisma.pilgrimField.findMany({ where: { isSystem: true }, select: { id: true, key: true, required: true } })
  for (const r of rows) {
    await prisma.pilgrimField.update({
      where: { id: r.id },
      data: { isActive: r.key === 'fullName' || active.includes(r.key), required: r.key === 'fullName' ? true : (requiredSystem[r.key] ?? r.required) },
    })
  }
  const created: string[] = []
  let order = 100
  for (const c of custom) {
    const f = await prisma.pilgrimField.create({ data: { key: c.key, label: c.label ?? c.key, fieldType: c.fieldType, required: c.required ?? false, order: order++, options: c.fieldType === 'select' ? [{ label: 'A', value: 'a' }] : undefined } })
    created.push(f.id)
  }
  return async function restore() {
    await prisma.pilgrimField.deleteMany({ where: { id: { in: created } } })
    for (const b of before) await prisma.pilgrimField.update({ where: { id: b.id }, data: { isActive: b.isActive, required: b.required } })
  }
}
