import { prisma } from '@/lib/db'

// docs/arsitektur-dokumen.md §4 — sumber kebenaran syarat dokumen, menggantikan
// VisaProduct.requirements (deprecated, dipertahankan sementara sampai semua pemanggil pindah).
export async function getDocumentRequirements(productType: string, productId: string) {
  return prisma.documentRequirement.findMany({
    where: { productType, productId },
    orderBy: { order: 'asc' },
  })
}
