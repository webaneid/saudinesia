'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Satu nilai + tombol salin (mis. nomor WhatsApp, kode verifikasi). Teksnya tetap bisa dipilih bila papan klip ditolak peramban.
type Props = {
  label: string
  /** Teks yang ditampilkan. */
  display: string
  /** Teks yang disalin (bawaan = tampilan). */
  value?: string
  copyLabel: string
  copiedLabel: string
  ariaLabel: string
  failedLabel: string
}

export function CopyValue({ label, display, value = display, copyLabel, copiedLabel, ariaLabel, failedLabel }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(value)
      setState('copied')
      timer.current = setTimeout(() => setState('idle'), 2000)
    } catch {
      setState('failed')
    }
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <code className="flex-auto select-all whitespace-nowrap rounded-md border bg-background px-3 py-2 font-mono text-sm font-semibold">{display}</code>
        <Button type="button" size="sm" variant="outline" className="grow" onClick={copy} aria-label={ariaLabel}>
          {state === 'copied' ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />} {state === 'copied' ? copiedLabel : copyLabel}
        </Button>
      </div>
      <p aria-live="polite" className={state === 'failed' ? 'mt-1 text-xs text-muted-foreground' : 'sr-only'}>{state === 'failed' ? failedLabel : state === 'copied' ? copiedLabel : ''}</p>
    </div>
  )
}
