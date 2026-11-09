// Pola geometri bintang delapan untuk permukaan hijau (hero, CTA). K6: tanpa foto sampai ada yang berhak dipakai. Dekoratif saja.
export function BrandPattern({ id }: { id: string }) {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/10" aria-hidden>
      <defs>
        <pattern id={id} width="72" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M36 8 44 28 64 36 44 44 36 64 28 44 8 36 28 28Z M16 16 36 24 56 16 48 36 56 56 36 48 16 56 24 36Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}
