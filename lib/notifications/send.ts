import { whatsapp } from '@/lib/whatsapp/client'
import { prisma } from '@/lib/db'

export type NotificationType =
  | 'otp'
  | 'booking_submitted'
  | 'payment_reminder_12h'
  | 'payment_reminder_22h'
  | 'payment_confirmed'
  | 'payment_rejected'
  | 'auto_cancelled'
  | 'visa_status_change'
  | 'departure_reminder_7d'
  | 'departure_reminder_1d'
  | 'refund_approved'

interface SendWhatsAppOpts {
  userId: string
  phone: string
  type: NotificationType
  message: string
  bookingId?: string
}

export async function sendWhatsApp(opts: SendWhatsAppOpts): Promise<void> {
  await whatsapp.sendMessage({ phone: opts.phone, message: opts.message })

  await prisma.notificationLog.create({
    data: {
      userId: opts.userId,
      bookingId: opts.bookingId ?? null,
      channel: 'whatsapp',
      type: opts.type,
      recipient: opts.phone,
      messagePreview: opts.message.slice(0, 200),
      status: 'sent',
    },
  })
}
