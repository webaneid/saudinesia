import { prisma } from '@/lib/db'
import { yearInApp } from '@/lib/time'

export async function generateBookingCode(): Promise<string> {
  const year = yearInApp()
  const count = await prisma.booking.count({
    where: { bookingCode: { startsWith: `SND-${year}-` } },
  })
  return `SND-${year}-${String(count + 1).padStart(5, '0')}`
}
