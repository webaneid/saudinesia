import { z } from 'zod'

export const phoneSchema = z
  .string()
  .min(9)
  .max(15)
  .regex(/^[0-9+]+$/, 'Invalid phone number')

export const otpRequestSchema = z.object({
  phone: phoneSchema,
})

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  code: z.string().length(6).regex(/^\d+$/),
})

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
