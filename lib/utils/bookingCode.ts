import { prisma } from '@/lib/db'

export async function generateBookingCode(): Promise<string> {
  const year = new Date().getFullYear()
  const count = await prisma.booking.count({
    where: { bookingCode: { startsWith: `SND-${year}-` } },
  })
  return `SND-${year}-${String(count + 1).padStart(5, '0')}`
}
