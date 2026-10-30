// Rekening/QRIS/pajak Pengaturan Invoice — handler bersama di lib/invoice/lists.ts (docs/arsitektur-booking-engine-v2.md §6).
import { qrisAccountHandlers } from '@/lib/invoice/lists'

export const GET = qrisAccountHandlers.GET
export const POST = qrisAccountHandlers.POST
