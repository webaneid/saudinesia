import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { CalendarDays, Plus, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BOOKING_STATUS } from '@/lib/constants/booking'

type Props = { params: Promise<{ locale: string }> }

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${locale}/login`)

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { fullName: true, email: true, phone: true },
  })

  const bookings = await prisma.booking.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { pilgrims: true } },
      payments: { where: { status: 'confirmed' }, take: 1 },
    },
  })

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Selamat datang, {user?.fullName?.split(' ')[0] ?? 'Jamaah'}</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>
        <Button asChild>
          {/* Wizard 7-langkah lama dihapus (docs/decisions.md 2026-07-25) — arahkan ke hub
              katalog publik sampai checkout pengganti per-produk dibangun. */}
          <Link href={`/${locale}`}>
            <Plus className="mr-2 h-4 w-4" /> Buat Booking Baru
          </Link>
        </Button>
      </div>

      {/* Booking list */}
      {bookings.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">Belum ada booking</p>
            <p className="text-sm text-muted-foreground mt-1">Mulai rencanakan perjalanan umrah Anda</p>
          </div>
          <Button asChild>
            {/* Wizard 7-langkah lama dihapus (docs/decisions.md 2026-07-25) — arahkan ke hub
              katalog publik sampai checkout pengganti per-produk dibangun. */}
          <Link href={`/${locale}`}>Buat Booking Pertama</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Riwayat Booking</h2>
          {bookings.map((b) => {
            const cfg = BOOKING_STATUS[b.status as keyof typeof BOOKING_STATUS] ?? { label: b.status, badge: 'secondary' }
            return (
              <Link key={b.id} href={`/${locale}/bookings/${b.id}`}
                className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 hover:border-primary hover:shadow-sm transition-all">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-primary">{b.bookingCode}</span>
                    <Badge variant={cfg.badge as 'warning' | 'secondary' | 'success' | 'default' | 'destructive' | 'muted'}>
                      {cfg.label}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {new Date(b.departureDate).toLocaleDateString('id-ID', { dateStyle: 'medium' })}
                    </span>
                    <span>{b._count.pilgrims} jamaah</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold">{formatRupiah(Number(b.totalAmount))}</p>
                  <p className="text-xs text-muted-foreground capitalize">{b.season}</p>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
