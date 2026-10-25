// Komponen Biaya — handler bersama (docs/arsitektur-komponen-biaya.md). Logika ada di lib/pricing/costComponentHandlers.ts.
import { createCostComponentHandlers } from '@/lib/pricing/costComponentHandlers'

const h = createCostComponentHandlers('tour_package')
export const PUT = h.itemPUT
export const DELETE = h.itemDELETE
