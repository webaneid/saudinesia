import { z } from 'zod'
import { CART_MAX_ITEMS, checkoutSchema, entryPeople, withPeople, type CheckoutCart, type CheckoutInput } from '@/lib/validators/checkout'
import { CHECKOUT_KINDS, type CheckoutKind } from './kinds'

// Keranjang pelanggan DI PERANGKAT (docs/arsitektur-booking-engine-v2.md §10.7, K11c-1 = a): `localStorage` kunci `snd-cart`. Isinya hanya pilihan
// produk (masukan checkout yang sama dengan halaman produk) + label tampilan — TANPA harga (harga selalu dari pratinjau server) dan TANPA data pribadi.
// Dibaca dengan Zod (isi rusak / versi lain dibuang); setiap akses dibungkus try/catch (mode privat, penyimpanan diblokir). Satu rombongan (K11c-2):
// `people` = jumlah jamaah keranjang, diterapkan ke setiap entri saat dikirim.

const KEY = 'snd-cart'
const CHANGED = 'snd-cart-changed'

const entrySchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(CHECKOUT_KINDS),
  productId: z.string().uuid(),
  title: z.string().max(200),
  summary: z.string().max(400),
  input: checkoutSchema,
}).strict()
const cartSchema = z.object({
  v: z.literal(1),
  people: z.number().int().min(1).max(100),
  entries: z.array(entrySchema).max(CART_MAX_ITEMS),
}).strict()

export type CartEntry = z.infer<typeof entrySchema>
export type DeviceCart = z.infer<typeof cartSchema>

const EMPTY: DeviceCart = { v: 1, people: 1, entries: [] }

let cache: { raw: string | null; cart: DeviceCart } = { raw: null, cart: EMPTY }

/** Isi keranjang (snapshot stabil untuk `useSyncExternalStore`). */
export function readCart(): DeviceCart {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(KEY) } catch { return EMPTY }
  if (raw === cache.raw) return cache.cart
  let cart = EMPTY
  if (raw) {
    try {
      const parsed = cartSchema.safeParse(JSON.parse(raw))
      if (parsed.success) cart = parsed.data
    } catch { /* isi rusak → kosong */ }
  }
  cache = { raw, cart }
  return cart
}

function write(cart: DeviceCart) {
  try {
    if (cart.entries.length === 0) window.localStorage.removeItem(KEY)
    else window.localStorage.setItem(KEY, JSON.stringify(cart))
  } catch { /* penyimpanan diblokir — keranjang tidak tersimpan */ }
  window.dispatchEvent(new Event(CHANGED))
}

export function subscribeCart(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) onChange() }
  window.addEventListener('storage', onStorage)
  window.addEventListener(CHANGED, onChange)
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(CHANGED, onChange) }
}

export const serverCart = (): DeviceCart => EMPTY

/** Alasan entri tak dapat ditambahkan (aturan keranjang yang sama dengan server), null = boleh. */
export function addRefusal(cart: DeviceCart, input: CheckoutInput): string | null {
  if (cart.entries.length >= CART_MAX_ITEMS) return `Keranjang penuh (maksimal ${CART_MAX_ITEMS} produk)`
  if (input.kind === 'haji') return 'Haji dipesan tersendiri — gunakan "Pesan sekarang"'
  if (cart.entries.some(e => e.kind === 'haji')) return 'Keranjang berisi Haji — Haji dipesan tersendiri'
  if (input.kind === 'visa' && cart.entries.some(e => e.kind === 'visa')) return 'Keranjang sudah berisi visa — satu pesanan satu jenis visa (hapus yang lama dulu)'
  return null
}

/** Tambah entri; jumlah jamaah keranjang = yang terbanyak (satu rombongan). */
export function addToCart(e: { kind: CheckoutKind; productId: string; title: string; summary: string; input: CheckoutInput }): string | null {
  const cart = readCart()
  const refusal = addRefusal(cart, e.input)
  if (refusal) return refusal
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  write({ v: 1, people: cart.entries.length === 0 ? entryPeople(e.input) : Math.max(cart.people, entryPeople(e.input)), entries: [...cart.entries, { id, ...e }] })
  return null
}

export function removeFromCart(id: string) {
  const cart = readCart()
  write({ ...cart, entries: cart.entries.filter(e => e.id !== id) })
}

export function setCartPeople(people: number) {
  write({ ...readCart(), people })
}

export function clearCart() { write(EMPTY) }

/** Isi keranjang → badan permintaan pesan/pratinjau (`checkoutCartSchema`), semua entri memakai jumlah jamaah keranjang. */
export function cartBody(cart: DeviceCart): CheckoutCart | null {
  if (cart.entries.length === 0) return null
  return { items: cart.entries.map(e => withPeople(e.input, cart.people)) }
}
