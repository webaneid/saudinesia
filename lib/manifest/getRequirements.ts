import { prisma } from '@/lib/db'
import type { ManifestFieldRequirement } from '@prisma/client'

// docs/arsitektur-manifest.md §4 — sumber kebenaran field manifest per produk.
export async function getManifestFieldRequirements(productType: string, productId: string) {
  return prisma.manifestFieldRequirement.findMany({
    where: { productType, productId },
    orderBy: { order: 'asc' },
  })
}

// Cari nilai field yang berperan `role` tertentu (mis. 'display_name', 'whatsapp') dari
// fieldValues seorang pilgrim — sistem (dashboard, notifikasi) butuh ini TANPA hardcode fieldKey
// (yang bebas admin atur). Kalau tidak ada field yang ditandai role itu, kembalikan null (bukan
// error) — pemanggil fallback ke tampilan generik. docs/arsitektur-manifest.md §4.
export function getFieldByRole(
  fields: ManifestFieldRequirement[],
  values: Record<string, unknown>,
  role: string,
): unknown | null {
  const field = fields.find(f => f.role === role)
  if (!field) return null
  return values[field.fieldKey] ?? null
}
