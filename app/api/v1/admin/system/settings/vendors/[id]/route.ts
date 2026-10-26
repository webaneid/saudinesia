// PONTE SEMENTARA ke layanan vendor baru (ADR-0003) — dihapus di F4. Lihat lib/vendors/legacyBridge.ts.
import { legacyVendorDELETE, legacyVendorPUT } from '@/lib/vendors/legacyBridge'

export const PUT = legacyVendorPUT
export const DELETE = legacyVendorDELETE
