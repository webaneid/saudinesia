import { z } from 'zod'

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export type ApiResponse<T = null> = {
  success: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
}

export function ok<T>(data: T, meta?: Record<string, unknown>): ApiResponse<T> {
  return { success: true, data, ...(meta ? { meta } : {}) }
}

export function err(message: string): ApiResponse {
  return { success: false, error: message }
}

/**
 * Record yang kunci/isinya bisa gagal: hitung kunci DULU, baru parse (SEC-211). Zod menghasilkan satu issue per kunci yang gagal
 * dan tidak punya `.max()` untuk record — tanpa ini satu body besar = ratusan ribu issue. Bukan objek → diteruskan ke `record` (pesan tipe bawaan).
 */
export function boundedKeys<T extends z.ZodType>(max: number, message: string, record: T) {
  return z.unknown().superRefine((v, ctx) => {
    if (typeof v === 'object' && v !== null && Object.keys(v).length > max) ctx.addIssue({ code: 'custom', message })
  }).pipe(record)
}
