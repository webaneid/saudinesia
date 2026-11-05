type Props = { label: string; danger?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }

/** Tombol ikon kecil pada baris editor (naik, turun, hapus). */
export function IconButton({ label, danger, disabled, onClick, children }: Props) {
  return (
    <button
      type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg transition-colors disabled:opacity-30 ${danger ? 'text-admin-muted hover:bg-admin-danger/10 hover:text-admin-danger' : 'text-admin-muted hover:bg-admin-spot hover:text-admin-ink'}`}
    >
      {children}
    </button>
  )
}
