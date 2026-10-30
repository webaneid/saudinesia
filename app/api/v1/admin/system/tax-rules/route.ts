// Rekening/QRIS/pajak Pengaturan Invoice — handler bersama di lib/invoice/lists.ts (docs/arsitektur-booking-engine-v2.md §6).
import { taxRuleHandlers } from '@/lib/invoice/lists'

export const GET = taxRuleHandlers.GET
export const POST = taxRuleHandlers.POST
