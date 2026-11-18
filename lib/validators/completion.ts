import { z } from 'zod'

/** Tandai selesai / Buka kembali booking (Fase 13d). */
export const bookingCompletionSchema = z.object({ action: z.enum(['complete', 'reopen']) }).strict()
