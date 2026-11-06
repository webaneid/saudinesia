'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PUBLIC_NAV } from './publicNav'

// Menu katalog di layar sempit. Lewat portal karena header memakai backdrop-filter: elemen `fixed` di dalamnya akan mengikuti header, bukan layar.
export function PublicMobileNav({ locale }: { locale: string }) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      trigger?.focus()
    }
  }, [open])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key !== 'Tab') return
    // Fokus tetap di dalam panel selama terbuka.
    const items = panelRef.current?.querySelectorAll<HTMLElement>('a, button')
    const first = items?.[0]
    const last = items?.[items.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }

  return (
    <>
      <Button ref={triggerRef} type="button" variant="ghost" size="icon" className="xl:hidden" aria-label={t('openMenu')} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Menu className="h-5 w-5" aria-hidden />
      </Button>
      {open && createPortal(
        <div className="fixed inset-0 z-[60] xl:hidden" onKeyDown={onKeyDown}>
          <div className="absolute inset-0 bg-foreground/40" aria-hidden onClick={() => setOpen(false)} />
          <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t('mainMenu')} className="absolute inset-y-0 right-0 flex w-full max-w-xs flex-col overflow-y-auto bg-background shadow-xl">
            <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
              <span className="text-sm font-semibold">{t('mainMenu')}</span>
              <Button ref={closeRef} type="button" variant="ghost" size="icon" aria-label={t('closeMenu')} onClick={() => setOpen(false)}>
                <X className="h-5 w-5" aria-hidden />
              </Button>
            </div>
            <nav className="p-2">
              {PUBLIC_NAV.map(({ key, path, icon: Icon }) => {
                const href = `/${locale}/${path}`
                const current = pathname === href || pathname.startsWith(`${href}/`)
                return (
                  <Link key={key} href={href} aria-current={current ? 'page' : undefined} onClick={() => setOpen(false)}
                    className={cn('flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors hover:bg-accent', current ? 'bg-primary/10 text-primary' : 'text-foreground')}>
                    <Icon className="h-4 w-4" aria-hidden />{t(key)}
                  </Link>
                )
              })}
            </nav>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
