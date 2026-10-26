import { legacyGalleryRoutes } from '@/lib/media/legacyRoutes'

// JEMBATAN SEMENTARA ke layanan media universal (lib/media/legacyRoutes.ts) — dihapus di F2 (docs/arsitektur-media.md).
const r = legacyGalleryRoutes('vehicle', 'v1/admin/products/transport/vehicles/[id]/images')
export const GET = r.GET
export const POST = r.POST
export const DELETE = r.DELETE
