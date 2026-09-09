import { z } from 'zod'

// docs/arsitektur-komponen-kontak.md §3.3 — semua field pakai .nullish() sejak awal (bukan
// .optional()) karena ContactPicker adalah form terkontrol yang selalu kirim null untuk field
// kosong, bukan undefined — pelajaran dari bug addressSchema (lib/validators/address.ts).
export const contactSchema = z.object({
  phoneCountryCode:    z.string().length(2).nullish(),
  phone:               z.string().min(1).nullish(),
  whatsappCountryCode: z.string().length(2).nullish(),
  whatsapp:            z.string().min(1).nullish(),
  email:               z.string().email().nullish().or(z.literal('')),
})

export type ContactInput = z.infer<typeof contactSchema>
