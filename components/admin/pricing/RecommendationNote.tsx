import { Info } from 'lucide-react'

/** Keterangan di bawah pratinjau "Harga Jual Rekomendasi" editor biaya: angka itu saran (modal + margin bawaan), bukan harga mati — harga jual diatur bebas di kartu harga. */
export function RecommendationNote() {
  return (
    <p className="m-0 flex items-start gap-1.5 text-[11px] text-admin-muted">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      Rekomendasi = modal + margin bawaan (Pengaturan Margin). Harga jual tetap bebas diatur lewat &quot;Atur harga manual&quot; di kartu harga; selisihnya terhadap margin ditandai di sana.
    </p>
  )
}
