import type { ReactNode } from 'react'

type FormFieldProps = {
  label: string
  htmlFor: string
  error?: string
  hint?: ReactNode
  required?: boolean
  /** Elemen di sisi kanan label (mis. tautan "Lupa password?"). */
  labelAside?: ReactNode
  children: ReactNode
}

export function FormField({ label, htmlFor, error, hint, required, labelAside, children }: FormFieldProps) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-sm font-semibold text-admin-ink">
          {label}
          {required && <span className="ml-0.5 text-admin-danger">*</span>}
        </label>
        {labelAside}
      </div>
      {children}
      {hint && !error && <p className="m-0 text-xs text-admin-muted">{hint}</p>}
      {error && <p className="m-0 text-xs font-medium text-admin-danger">{error}</p>}
    </div>
  )
}
