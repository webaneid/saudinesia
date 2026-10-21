import type { ReactNode } from 'react'

type AdminAuthShellProps = { title: string; description?: string; children: ReactNode }

/** Kerangka halaman masuk admin: latar hijau brand, logo + nama, kartu putih di tengah. */
export function AdminAuthShell({ title, description, children }: AdminAuthShellProps) {
  return (
    <main className="panel-brand grid min-h-dvh place-items-center px-4 py-10 font-jakarta">
      <div className="relative z-10 grid w-full max-w-sm gap-5">
        <div className="grid justify-items-center gap-2 text-center">
          <span className="grid size-16 place-items-center rounded-2xl bg-white text-2xl font-extrabold text-admin-accent shadow-admin">Sn</span>
          <div>
            <p className="m-0 text-xl font-extrabold tracking-tight text-white">Saudinesia</p>
            <p className="m-0 text-sm text-white/75">Panel Admin</p>
          </div>
        </div>
        <section className="kartu grid gap-4 p-5 text-admin-ink sm:p-6">
          <header>
            <h1 className="m-0 text-lg font-extrabold tracking-tight">{title}</h1>
            {description && <p className="m-0 mt-1 text-sm text-admin-muted">{description}</p>}
          </header>
          {children}
        </section>
        <p className="m-0 text-center text-xs text-white/60">© {new Date().getFullYear()} Saudinesia</p>
      </div>
    </main>
  )
}
