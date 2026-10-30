// Rekening/QRIS/pajak Pengaturan Invoice — handler bersama di lib/invoice/lists.ts (docs/arsitektur-booking-engine-v2.md §6).
import { bankAccountHandlers } from '@/lib/invoice/lists'

export const GET = bankAccountHandlers.GET
export const POST = bankAccountHandlers.POST
