'use client'

import type { KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TabItem<T extends string = string> = {
  id: T
  label: string
  icon?: LucideIcon
  /** Penanda kecil di samping label (jumlah item, atau "!" untuk perlu perhatian). */
  count?: number | string
}

type TabsProps<T extends string> = {
  items: readonly TabItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
}

/** id tombol tab dan panel — pasangkan: panel `id={tabPanelId(x)}` `aria-labelledby={tabId(x)}` `role="tabpanel"`. */
export const tabId = (id: string) => `tab-${id}`
export const tabPanelId = (id: string) => `tabpanel-${id}`

/** Bilah tab bergaris bawah. HP: bisa digeser ke samping. Panah kiri/kanan berpindah tab. */
export function Tabs<T extends string>({ items, value, onChange, label }: TabsProps<T>) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = items.findIndex(t => t.id === value)
    const next = items[(i + (e.key === 'ArrowRight' ? 1 : items.length - 1)) % items.length]
    if (!next) return
    onChange(next.id)
    e.currentTarget.querySelector<HTMLElement>(`#${tabId(next.id)}`)?.focus()
  }
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 overflow-x-auto border-b border-admin-line scrollbar-none">
      {items.map(({ id, label: text, icon: Icon, count }) => {
        const active = id === value
        return (
          <button
            key={id}
            id={tabId(id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={tabPanelId(id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              '-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/30',
              active ? 'border-admin-accent text-admin-accent-strong' : 'border-transparent text-admin-muted hover:text-admin-ink',
            )}
          >
            {Icon && <Icon className="size-4" />}
            {text}
            {count !== undefined && (
              <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', active ? 'bg-admin-accent/12 text-admin-accent-strong' : 'bg-admin-spot text-admin-muted')}>
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
