import { cn } from '@/lib/utils'

/**
 * Bendera negara sebagai gambar SVG statis (`public/flags/<ISO>.svg`, disalin `scripts/sync-flags.ts`) — tampil sama di semua perangkat.
 * Emoji bendera tidak dipakai: Windows tidak menggambarnya (hanya dua huruf kode negara). Dekoratif (`alt=""`): nama negara selalu tertulis di sebelahnya.
 */
export function Flag({ code, className }: { code: string; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG statis kecil dari /public; next/image tak diperlukan (tanpa optimasi, SVG diblokir secara bawaan)
    <img
      src={`/flags/${code.toUpperCase()}.svg`} alt="" aria-hidden width={20} height={14} loading="lazy" decoding="async"
      className={cn('h-3.5 w-5 shrink-0 rounded-[2px] object-cover ring-1 ring-black/10', className)}
    />
  )
}
