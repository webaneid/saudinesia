import { legacySingleRoutes } from '@/lib/media/legacyRoutes'

// JEMBATAN SEMENTARA ke layanan media universal (lib/media/legacyRoutes.ts) — dihapus di F2 (docs/arsitektur-media.md).
const r = legacySingleRoutes('tourism_site', 'v1/admin/products/tourism-sites/[id]/photo')
export const POST = r.POST
export const DELETE = r.DELETE
