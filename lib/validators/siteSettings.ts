import { z } from 'zod'

export const siteSettingSchema = z.object({
  platformName: z.string().max(100).nullish(),
  metaTitle: z.string().max(160).nullish(),
  metaDescription: z.string().max(300).nullish(),
  contactEmail: z.string().email('Format email tidak valid').nullish().or(z.literal('')),
  contactPhone: z.string().max(20).nullish(),
  emailNotificationsEnabled: z.boolean().optional(),
})

export type SiteSettingInput = z.infer<typeof siteSettingSchema>
