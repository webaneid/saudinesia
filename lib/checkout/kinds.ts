// Jenis checkout pelanggan (docs/arsitektur-booking-engine-v2.md §10.5). Murni — dipakai server, klien, dan penyaring jalur kembali (lib/auth/nextPath.ts).
// Jenis baru = entri di sini + `case` di halaman checkout + skema `checkoutItemSchema`.

export const CHECKOUT_KINDS = ['package', 'visa', 'transport', 'haji'] as const
export type CheckoutKind = (typeof CHECKOUT_KINDS)[number]

export const isCheckoutKind = (v: string): v is CheckoutKind => (CHECKOUT_KINDS as readonly string[]).includes(v)

/** Jalur halaman checkout satu produk. `id` = produk (Transport: rute). */
export const checkoutPath = (locale: string, kind: CheckoutKind, id: string): string => `/${locale}/checkout/${kind}?id=${id}`
