// Pengingat keberangkatan (docs/arsitektur-notifikasi.md §13, K1 = H-7 dan H-1): jarak hari per tipe kejadian — SATU tempat untuk pemilih cron, WhatsApp, dan email.
export const DEPARTURE_REMINDER_DAYS = { departure_reminder_7d: 7, departure_reminder_1d: 1 } as const
export type DepartureReminderType = keyof typeof DEPARTURE_REMINDER_DAYS
export const departureDays = (type: DepartureReminderType): number => DEPARTURE_REMINDER_DAYS[type]
