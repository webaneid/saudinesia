// Vendor — handler bersama (ADR-0003, docs/arsitektur-vendor.md §3.3). Logika ada di lib/vendors/handlers.ts.
import { createVendorHandlers } from '@/lib/vendors/handlers'

const h = createVendorHandlers()
export const GET = h.categoriesGET
export const POST = h.categoriesPOST
