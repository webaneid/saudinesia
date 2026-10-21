import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'outline' | 'ghost' | 'glass'
type Size = 'sm' | 'md' | 'icon'

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'bg-admin-accent text-white shadow-admin hover:bg-admin-accent-strong',
  // Emas: CTA paling menonjol. Teks hijau tua — putih di atas emas tidak lolos kontras AA.
  accent: 'bg-admin-gold text-admin-accent-strong shadow-admin hover:bg-admin-gold-strong hover:text-white',
  secondary: 'bg-admin-spot text-admin-ink hover:bg-admin-line',
  danger: 'bg-admin-danger text-white hover:opacity-90',
  outline: 'border border-admin-line bg-white text-admin-ink hover:border-admin-line-strong',
  ghost: 'text-admin-ink hover:bg-admin-spot',
  // Kaca: di atas permukaan hijau (sidebar, panel-brand).
  glass: 'glass text-white hover:bg-white/20',
}

const SIZE_CLASS: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-xs',
  md: 'min-h-11 px-4 text-sm',
  icon: 'size-11 p-0',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition disabled:pointer-events-none disabled:opacity-55',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
})
