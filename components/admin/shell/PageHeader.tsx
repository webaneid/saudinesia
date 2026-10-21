import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

type PageHeaderProps = { title: string; description?: string; actions?: ReactNode; icon?: LucideIcon }

export function PageHeader({ title, description, actions, icon: Icon }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="m-0 flex items-center gap-2 text-xl font-extrabold tracking-tight sm:text-2xl">
          {Icon && <Icon className="size-5 shrink-0 text-admin-accent" />}
          {title}
        </h1>
        {description && <p className="m-0 mt-1 text-sm text-admin-muted">{description}</p>}
      </div>
      {/* HP: tombol tidak dilipat per kata; bila tak muat, turun ke baris berikutnya. */}
      {actions && <div className="flex flex-wrap gap-2 [&_a]:whitespace-nowrap [&_button]:whitespace-nowrap">{actions}</div>}
    </div>
  )
}
