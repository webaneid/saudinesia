'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, LogOut } from 'lucide-react'
import { Badge } from '@/components/admin/ui/Badge'

type UserDropdownProps = { locale: string; userName: string; email: string; roleLabel: string }

export function UserDropdown({ locale, userName, email, roleLabel }: UserDropdownProps) {
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  async function logout() {
    setLoggingOut(true)
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' })
    } finally {
      router.replace(`/${locale}/admin/login`)
      router.refresh()
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-label="Menu pengguna"
        aria-expanded={open}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-admin-line bg-white px-1.5 text-sm font-medium sm:px-2.5"
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-admin-accent text-xs font-bold text-admin-gold">
          {userName.charAt(0).toUpperCase() || 'A'}
        </span>
        <span className="hidden max-w-36 truncate md:inline">{userName}</span>
        <ChevronDown className="hidden size-3.5 text-admin-muted sm:block" />
      </button>
      {open && (
        <div className="kartu absolute right-0 top-[calc(100%+8px)] z-40 w-[min(15rem,calc(100vw-2rem))] p-1.5">
          <div className="grid gap-1 px-3 py-2">
            <p className="m-0 truncate text-sm font-semibold">{userName}</p>
            <p className="m-0 truncate text-xs text-admin-muted">{email}</p>
            <Badge tone="accent" className="w-fit">{roleLabel}</Badge>
          </div>
          <hr className="my-1 border-admin-line" />
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-admin-danger hover:bg-admin-danger/10 disabled:opacity-55"
          >
            <LogOut className="size-4" />
            {loggingOut ? 'Keluar…' : 'Keluar'}
          </button>
        </div>
      )}
    </div>
  )
}
