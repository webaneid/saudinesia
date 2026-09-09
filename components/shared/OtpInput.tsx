'use client'
// Needs useState + useEffect for the countdown timer and digit-input state

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface OtpInputProps {
  length?: number
  onComplete: (code: string) => void
  disabled?: boolean
  error?: string
}

export function OtpInput({ length = 6, onComplete, disabled, error }: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''))
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  function handleChange(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)

    if (digit && index < length - 1) {
      inputs.current[index + 1]?.focus()
    }

    const code = next.join('')
    if (code.length === length && next.every(Boolean)) {
      onComplete(code)
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus()
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
    const next = Array(length).fill('')
    pasted.split('').forEach((c, i) => { next[i] = c })
    setDigits(next)
    const lastFilled = Math.min(pasted.length, length - 1)
    inputs.current[lastFilled]?.focus()
    if (pasted.length === length) onComplete(pasted)
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-center" onPaste={handlePaste}>
        {digits.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el }}
            type="tel"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            disabled={disabled}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={cn(
              'h-12 w-10 rounded-md border text-center text-lg font-semibold',
              'bg-background ring-offset-background',
              'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error ? 'border-destructive' : 'border-input',
            )}
          />
        ))}
      </div>
      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  )
}

interface CountdownProps {
  seconds: number
  onResend: () => void
  disabled: boolean
}

export function OtpCountdown({ seconds, onResend, disabled }: CountdownProps) {
  return (
    <div className="text-center text-sm text-muted-foreground">
      {seconds > 0 ? (
        <span>Kirim ulang dalam {seconds} detik</span>
      ) : (
        <button
          type="button"
          onClick={onResend}
          disabled={disabled}
          className="text-primary hover:underline disabled:opacity-50"
        >
          Kirim ulang OTP
        </button>
      )}
    </div>
  )
}

export function useOtpCountdown(initialSeconds = 60) {
  const [seconds, setSeconds] = useState(initialSeconds)

  useEffect(() => {
    if (seconds <= 0) return
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [seconds])

  function reset() { setSeconds(initialSeconds) }

  return { seconds, reset }
}
