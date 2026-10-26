// PONTE SEMENTARA ke layanan vendor baru (ADR-0003) — dihapus di F4. Lihat lib/vendors/legacyBridge.ts.
import { legacyVendorsGET, legacyVendorsPOST } from '@/lib/vendors/legacyBridge'

export const GET = legacyVendorsGET
export const POST = legacyVendorsPOST
