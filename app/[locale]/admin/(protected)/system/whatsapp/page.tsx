import { redirect } from 'next/navigation'
import { MessageCircle } from 'lucide-react'
import { SUPERADMIN_ROLES } from '@/lib/auth/session'
import { requireAdminPage } from '@/lib/auth/pageGuards'
import { safeLocale } from '@/lib/utils/locale'
import { adminHref } from '@/lib/admin/href'
import { PageHeader } from '@/components/admin/shell/PageHeader'
import { panelStatus } from '@/lib/whatsapp/admin'
import { listWaTemplates } from '@/lib/whatsapp/templates'
import { WhatsappPanel } from './WhatsappPanel'
import { WhatsappTemplates } from './WhatsappTemplates'

// Sistem → WhatsApp (docs/rencana-gowa-self-host.md §4.1) — hanya superadmin (K5). Status awal dibaca di server; tindakan lewat
// /api/v1/admin/system/whatsapp (GOWA tak pernah dijangkau browser).
export default async function WhatsappPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const session = await requireAdminPage(locale)
  if (!SUPERADMIN_ROLES.includes(session.role)) redirect(adminHref(safeLocale(locale), '/admin'))
  const [initial, templates] = await Promise.all([panelStatus(), listWaTemplates()])
  return (
    <div className="space-y-5">
      <PageHeader
        title="WhatsApp"
        description="Hubungkan nomor bisnis ke gateway WhatsApp (GOWA) di server sendiri dan atur teks notifikasinya. Notifikasi WhatsApp hanya terkirim saat terhubung; email tetap terkirim apa pun keadaannya."
        icon={MessageCircle}
      />
      <WhatsappPanel initial={initial} />
      <WhatsappTemplates templates={templates} />
    </div>
  )
}
