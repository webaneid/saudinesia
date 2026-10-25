// Komponen Biaya — handler bersama (docs/arsitektur-komponen-biaya.md). Logika ada di lib/pricing/costComponentHandlers.ts.
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'

const h = createCostComponentHandlers('package')
export const GET = h.collectionGET
export const POST = h.collectionPOST
