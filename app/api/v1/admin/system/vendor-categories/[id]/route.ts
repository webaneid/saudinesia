// Vendor — handler bersama (ADR-0003, docs/arsitektur-vendor.md §3.3). Logika ada di lib/vendors/handlers.ts.
import { createVendorHandlers } from '@/lib/vendors/handlers'

const h = createVendorHandlers()
export const PUT = h.categoryPUT
export const DELETE = h.categoryDELETE
