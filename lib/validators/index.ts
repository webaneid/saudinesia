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
