/**
 * Prisma `P2025` = baris yang mau di-update/delete tidak ada. Untuk id dari URL itu artinya 404, bukan 500 (SEC-61).
 * Dicek lewat `code` (bukan `instanceof PrismaClientKnownRequestError`) supaya tahan terhadap salinan Prisma ganda di bundel.
 */
export function isRecordNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'P2025'
}
