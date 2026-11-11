import { redirect } from 'next/navigation'
import { safeLocale } from '@/lib/utils/locale'
import Link from 'next/link'
import { getSession } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { formatRupiah } from '@/lib/utils'
import { billOf, billSelect } from '@/lib/invoice/bill'
import { ArrowRight, CheckCircle, ClipboardList, FileText, Plus, UsersRound, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { bookingWhere, displayStatusOf, statusSelect } from '@/lib/booking/lifecycle'
import { formatCalendarDate } from '@/lib/time'
import { getTranslations } from 'next-intl/server'
import type { Prisma } from '@prisma/client'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props) {
  const tm = await getTranslations({ locale: safeLocale((await params).locale), namespace: 'pilgrimArea.dashboard' })
  return { title: tm('metaTitle') }
}

// Dashboard jamaah: "Perlu tindakan" — booking aktif yang menunggu pembayaran atau jamaahnya belum diajukan/perlu perbaikan, masing-masing
// bertaut langsung ke bagian booking yang harus dikerjakan (#pembayaran / #data-jamaah). Daftar lengkap ada di Booking Saya (/bookings).
const ACTION_LIMIT = 5

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params
  const session = await getSession()
  if (!session) redirect(`/${safeLocale(locale)}/login`)

  const pendingPilgrims: Prisma.BookingPilgrimWhereInput = { reviewStatus: { in: ['draft', 'needs_revision'] } }
  const [user, ownBookings, actions] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { fullName: true, email: true, whatsapp: true, whatsappVerifiedAt: true, verifiedWhatsapp: true },
    }),
    prisma.booking.count({ where: { userId: session.userId, status: { not: 'draft' } } }),
    prisma.booking.findMany({
      where: { userId: session.userId, status: 'active', OR: [bookingWhere.awaiting_payment, { pilgrims: { some: pendingPilgrims } }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ACTION_LIMIT,
      select: {
        id: true, bookingCode: true, totalAmount: true, ...statusSelect, invoice: billSelect.invoice,
        pilgrims: { where: pendingPilgrims, select: { reviewStatus: true } },
      },
    }),
  ])

  const href = (id: string, part: string) => `/${locale}/bookings/${id}#${part}`
  const lang = safeLocale(locale)
  const t = await getTranslations({ locale: lang, namespace: 'pilgrimArea' })

  return (
    <div className="space-y-8">
      {/* Ajakan verifikasi WhatsApp — TIDAK menghalangi apa pun; email tetap kanal notifikasi (ADR-0002) */}
      {user?.whatsapp && !(user.whatsappVerifiedAt && user.verifiedWhatsapp === user.whatsapp) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{t('dashboard.waBanner')}</span>
          <Link href={`/${safeLocale(locale)}/profile#verifikasi-whatsapp`} className="font-semibold underline">{t('dashboard.waVerify')}</Link>
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.welcome', { name: user?.fullName?.split(' ')[0] ?? t('dashboard.defaultName') })}</h1>
          <p className="text-muted-foreground">{user?.email}</p>
        </div>
        <Button asChild>
          <Link href={`/${locale}`}><Plus className="mr-2 h-4 w-4" /> {t('newBooking')}</Link>
        </Button>
      </div>

      {ownBookings === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <FileText className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold">{t('empty.title')}</p>
            <p className="text-sm text-muted-foreground mt-1">{t('empty.text')}</p>
          </div>
          <Button asChild><Link href={`/${locale}`}>{t('empty.cta')}</Link></Button>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardList className="h-5 w-5" /> {t('dashboard.actions')}</h2>
            <Link href={`/${locale}/bookings`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              {t('dashboard.allBookings', { count: ownBookings })} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {actions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border p-4 text-sm text-muted-foreground">
              <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" /> {t('dashboard.nothing')}
            </div>
          ) : (
            <ul className="space-y-3">
              {actions.map(b => {
                const unpaid = displayStatusOf(b) === 'awaiting_payment'
                const revise = b.pilgrims.filter(p => p.reviewStatus === 'needs_revision').length
                const incomplete = b.pilgrims.length - revise
                return (
                  <li key={b.id} className="rounded-xl border p-4 space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={`/${locale}/bookings/${b.id}`} className="font-mono text-sm font-bold text-primary hover:underline">{b.bookingCode}</Link>
                      <span className="text-xs text-muted-foreground">{b.departureDate ? t('dashboard.departs', { date: formatCalendarDate(b.departureDate, undefined, lang) }) : t('dashboard.dateTbd')}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {unpaid && (
                        <Button asChild size="sm">
                          <Link href={href(b.id, 'pembayaran')}><Wallet className="h-4 w-4" /> {t('dashboard.pay', { amount: formatRupiah(billOf({ totalAmount: b.totalAmount, invoice: b.invoice }).grandTotal) })}</Link>
                        </Button>
                      )}
                      {revise > 0 && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={href(b.id, 'data-jamaah')}><UsersRound className="h-4 w-4" /> {t('dashboard.revise', { count: revise })}</Link>
                        </Button>
                      )}
                      {incomplete > 0 && (
                        <Button asChild size="sm" variant="outline">
                          <Link href={href(b.id, 'data-jamaah')}><UsersRound className="h-4 w-4" /> {t('dashboard.complete', { count: incomplete })}</Link>
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
