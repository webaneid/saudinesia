import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  /** Judul kolom. Kosong = kolom aksi (di kartu HP pindah ke dasar kartu). */
  header: string
  cell: (row: T) => ReactNode
  /** Sembunyikan kolom di tabel pada layar lebih sempit dari lg (kartu HP tetap menampilkannya). */
  hideBelowLg?: boolean
  align?: 'left' | 'right'
  /** Peran di kartu HP: title = judul kartu (bawaan: kolom pertama), field = "label: nilai" (bawaan bila ada header), footer = aksi di dasar (bawaan bila tanpa header). */
  mobile?: 'title' | 'field' | 'footer'
  /** Kolom AKSI standar (docs/arsitektur-tabel.md §2.4): isi memakai <RowActions>; judul "Aksi", rata kanan, lebar pas, dan di HP pindah ke dasar kartu. */
  actions?: boolean
}

type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  getRowId: (row: T) => string
  /** Teks/elemen saat `rows` kosong. */
  empty?: ReactNode
  /** Tampilkan baris kerangka (untuk halaman client yang memuat data via fetch). */
  loading?: boolean
  /** Di dalam kartu, di bawah tabel — biasanya <Pagination />. */
  footer?: ReactNode
  /** Kelas tambahan per baris (mis. redup untuk data nonaktif); berlaku di tabel maupun kartu HP. */
  rowClassName?: (row: T) => string | undefined
}

const SKELETON_ROWS = 5

/**
 * Tabel standar admin. Tanpa hook, jadi Server Component boleh melempar `cell: (row) => ...` langsung.
 * Layar >= md: tabel. Layar HP: tiap baris jadi kartu — baca `Column.mobile`.
 */
export function DataTable<T>({ columns, rows, getRowId, empty = 'Tidak ada data.', loading, footer, rowClassName }: DataTableProps<T>) {
  const roleOf = (c: Column<T>): NonNullable<Column<T>['mobile']> => c.mobile ?? (c.actions || !c.header ? 'footer' : 'field')
  const titleCol = columns.find(c => c.mobile === 'title') ?? columns.find(c => roleOf(c) !== 'footer')
  const fieldCols = columns.filter(c => c !== titleCol && roleOf(c) === 'field')
  const footerCols = columns.filter(c => c !== titleCol && roleOf(c) === 'footer')

  return (
    <div className="kartu overflow-hidden">
      {/* Tabel (>= md); bila lebih lebar dari wadahnya (panel sempit) menggulir ke samping — kolom aksi tak pernah terpotong */}
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-admin-line bg-admin-spot/40">
          <tr>
            {columns.map(c => (
              <th
                key={c.key}
                className={cn(
                  'px-4 py-3 text-[10.5px] font-bold uppercase tracking-[0.1em] text-admin-muted',
                  c.hideBelowLg && 'hidden lg:table-cell',
                  (c.align === 'right' || c.actions) && 'text-right',
                  c.actions && 'w-px whitespace-nowrap',
                )}
              >
                {c.header || (c.actions ? 'Aksi' : '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-line">
          {loading
            ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <tr key={i}>
                  <td colSpan={columns.length} className="px-4 py-3.5"><div className="h-4 animate-pulse rounded-md bg-admin-spot" /></td>
                </tr>
              ))
            : rows.map(row => (
                <tr key={getRowId(row)} className={cn('transition-colors hover:bg-admin-spot/40', rowClassName?.(row))}>
                  {columns.map(c => (
                    <td key={c.key} className={cn('px-4 py-3 align-top', c.hideBelowLg && 'hidden lg:table-cell', (c.align === 'right' || c.actions) && 'text-right', c.actions && 'w-px whitespace-nowrap')}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      </div>

      {/* Kartu (HP) */}
      <ul className="m-0 list-none divide-y divide-admin-line p-0 md:hidden">
        {loading
          ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
              <li key={i} className="p-4"><div className="h-12 animate-pulse rounded-md bg-admin-spot" /></li>
            ))
          : rows.map(row => (
              <li key={getRowId(row)} className={cn('grid gap-2.5 p-4', rowClassName?.(row))}>
                {titleCol && <div className="text-sm font-semibold">{titleCol.cell(row)}</div>}
                {fieldCols.length > 0 && (
                  <dl className="m-0 grid gap-1.5">
                    {fieldCols.map(c => (
                      <div key={c.key} className="flex items-start justify-between gap-3">
                        <dt className="label-kecil shrink-0 pt-0.5">{c.header}</dt>
                        <dd className="m-0 min-w-0 text-right text-sm">{c.cell(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {footerCols.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-2">{footerCols.map(c => <span key={c.key}>{c.cell(row)}</span>)}</div>
                )}
              </li>
            ))}
      </ul>

      {!loading && rows.length === 0 && (
        <div className="px-4 py-12 text-center text-sm text-admin-muted">{empty}</div>
      )}
      {footer && <div className="border-t border-admin-line px-4 py-3">{footer}</div>}
    </div>
  )
}
