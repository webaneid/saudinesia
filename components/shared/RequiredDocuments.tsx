import { FileText, Info, ShieldCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { RequirementView } from '@/lib/documents/completeness'

// Daftar "Persyaratan Dokumen" di kartu katalog publik (Visa, Paket Umroh, Haji) — dibaca lewat `requirementsOfMany` (lib/documents/requirements.ts).
// Hanya label publik + petunjuk; wajib dan opsional dipisah. Label/petunjuk syarat = data admin (tetap seperti diisi); judul lewat `shared.requiredDocs`.
export function RequiredDocuments({ requirements }: { requirements: readonly RequirementView[] }) {
  const t = useTranslations('shared.requiredDocs')
  if (requirements.length === 0) return null
  const required = requirements.filter(r => r.required)
  const optional = requirements.filter(r => !r.required)
  return (
    <div className="space-y-2.5 pt-1 border-t border-border">
      <p className="text-xs font-semibold flex items-center gap-1.5 text-foreground">
        <FileText className="h-3.5 w-3.5 text-brand" aria-hidden />
        {t('title')}
      </p>

      {required.length > 0 && (
        <ul className="space-y-1.5">
          {required.map(req => (
            <li key={req.documentTypeId} className="flex items-start gap-2 text-xs">
              <ShieldCheck className="h-3.5 w-3.5 text-brand mt-0.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">{req.label}</span>
                {req.description && <span className="text-muted-foreground"> — {req.description}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {optional.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground font-medium">{t('optional')}</p>
          <ul className="space-y-1">
            {optional.map(req => (
              <li key={req.documentTypeId} className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                <span>
                  <span className="font-medium">{req.label}</span>
                  {req.description && <span> — {req.description}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
