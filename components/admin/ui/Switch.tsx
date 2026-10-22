import { cn } from '@/lib/utils'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Wajib: nama aksesibel untuk pembaca layar (switch tidak punya teks sendiri). */
  label: string
  id?: string
  disabled?: boolean
  className?: string
}

/** Saklar on/off aksesibel (role="switch"). Pasangkan dengan teks status di sebelahnya. */
export function Switch({ checked, onChange, label, id, disabled, className }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-accent/40 disabled:opacity-50',
        checked ? 'bg-admin-accent' : 'bg-admin-line-strong',
        className,
      )}
    >
      <span className={cn('absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform', checked && 'translate-x-5')} />
    </button>
  )
}
