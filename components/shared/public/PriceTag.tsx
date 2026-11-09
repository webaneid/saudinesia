import { formatRupiah } from '@/lib/utils'

type Props = {
  /** Harga jual; `null`/≤ 0 = belum berharga → tidak menampilkan angka (tak pernah "Rp 0"). */
  price: number | null | undefined
  label?: string | null
  unit?: string | null
  note?: string | null
  /** Teks pengganti bila belum berharga; kosong = tidak menampilkan apa pun. */
  unpriced?: string | null
  size?: 'md' | 'lg'
}

// Harga di kartu katalog (docs/arsitektur-frontend-publik.md §6.7 G2). Hanya harga jual (K4).
export function PriceTag({ price, label, unit, note, unpriced, size = 'lg' }: Props) {
  if (!price || price <= 0) return unpriced ? <p className="text-sm font-medium text-muted-foreground">{unpriced}</p> : null
  return (
    <div>
      {label && <p className="text-xs text-muted-foreground">{label}</p>}
      <p className={`font-bold text-brand ${size === 'lg' ? 'text-2xl' : 'text-xl'}`}>
        {formatRupiah(price)}
        {unit && <span className="text-sm font-normal text-muted-foreground"> {unit}</span>}
      </p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
    </div>
  )
}
