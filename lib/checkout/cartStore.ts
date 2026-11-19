import { z } from 'zod'
import { CART_MAX_ITEMS, CHECKOUT_MAX_PEOPLE, checkoutSchema, entryPeople, withPeople, type CheckoutCart, type CheckoutInput } from '@/lib/validators/checkout'
import { CHECKOUT_KINDS, type CheckoutKind } from './kinds'

// Keranjang pelanggan DI PERANGKAT (docs/arsitektur-booking-engine-v2.md §10.7, K11c-1 = a): `localStorage` kunci `snd-cart`. Isinya hanya pilihan
// produk (masukan checkout yang sama dengan halaman produk) + nama produk — TANPA harga (harga selalu dari pratinjau server) dan TANPA data pribadi.
// Dibaca dengan Zod (isi rusak / versi lain dibuang); setiap akses dibungkus try/catch (mode privat, penyimpanan diblokir). Satu rombongan (K11c-2):
// `people` = jumlah jamaah keranjang, diterapkan ke setiap entri saat dikirim. Sejak 11d-3 (v2): `groups` (1 = satu rombongan, persis 11c) dan
// `group` per entri (kosong = semua jamaah); v1 dibaca dan diubah otomatis.

/** Panjang maksimal nama rombongan (= `bookingGroupSchema`). */
export const CART_GROUP_LABEL_MAX = 60

const KEY = 'snd-cart'
const CHANGED = 'snd-cart-changed'

const entrySchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(CHECKOUT_KINDS),
  productId: z.string().uuid(),
  title: z.string().max(200),
  /** Ringkasan teks lama (sebelum I3) — tak lagi ditulis; ringkasan kini dibangun halaman dari `input` dalam bahasa halaman. Dibiarkan opsional supaya keranjang lama tetap terbaca. */
  summary: z.string().max(400).optional(),
  input: checkoutSchema,
  /** Rombongan sasaran (indeks ke `groups`; kosong = semua jamaah). Hanya bermakna bila rombongan ≥ 2 (Fase 11d-3). */
  group: z.number().int().min(0).max(CHECKOUT_MAX_PEOPLE - 1).optional(),
}).strict()
/** Nama rombongan di perangkat = teks yang sedang diketik (boleh kosong); dirapikan saat dikirim (`cartBody`). */
const groupSchema = z.object({ size: z.number().int().min(1).max(CHECKOUT_MAX_PEOPLE), label: z.string().max(CART_GROUP_LABEL_MAX) }).strict()
const cartSchema = z.object({
  v: z.literal(2),
  groups: z.array(groupSchema).min(1).max(CHECKOUT_MAX_PEOPLE),
  entries: z.array(entrySchema).max(CART_MAX_ITEMS),
}).strict()
/** Keranjang 11c (satu rombongan) — dibaca lalu diubah ke v2. */
const cartV1Schema = z.object({
  v: z.literal(1),
  people: z.number().int().min(1).max(CHECKOUT_MAX_PEOPLE),
  entries: z.array(entrySchema.omit({ group: true })).max(CART_MAX_ITEMS),
}).strict()

export type CartEntry = z.infer<typeof entrySchema>
export type DeviceCart = z.infer<typeof cartSchema>

const EMPTY: DeviceCart = { v: 2, groups: [{ size: 1, label: '' }], entries: [] }

let cache: { raw: string | null; cart: DeviceCart } = { raw: null, cart: EMPTY }

/** Isi keranjang (snapshot stabil untuk `useSyncExternalStore`). */
export function readCart(): DeviceCart {
  let raw: string | null = null
  try { raw = window.localStorage.getItem(KEY) } catch { return EMPTY }
  if (raw === cache.raw) return cache.cart
  let cart = EMPTY
  if (raw) {
    try {
      const json: unknown = JSON.parse(raw)
      const parsed = cartSchema.safeParse(json)
      if (parsed.success) cart = parsed.data
      else {
        const old = cartV1Schema.safeParse(json)
        if (old.success) cart = { v: 2, groups: [{ size: old.data.people, label: '' }], entries: old.data.entries }
      }
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

/** Alasan entri tak dapat ditambahkan — kunci `checkout.cartRefusal.*` (argumen `max` = CART_MAX_ITEMS). */
export type CartRefusal = 'full' | 'hajiAlone' | 'cartHasHaji' | 'oneVisa'
export const CART_REFUSALS: readonly CartRefusal[] = ['full', 'hajiAlone', 'cartHasHaji', 'oneVisa']

/** Jumlah orang seluruh keranjang (Σ rombongan). */
export const cartPeople = (cart: DeviceCart): number => cart.groups.reduce((sum, g) => sum + g.size, 0)
export const isGroupedCart = (cart: DeviceCart): boolean => cart.groups.length > 1

/** Rombongan pertama yang belum punya visa (keranjang berrombongan), -1 bila semua sudah. */
function firstGroupWithoutVisa(cart: DeviceCart): number {
  return cart.groups.findIndex((_, g) => !cart.entries.some(e => e.kind === 'visa' && e.group === g))
}

/** Alasan entri tak dapat ditambahkan (aturan keranjang yang sama dengan server), null = boleh. Visa: satu per rombongan (11d-3). */
export function addRefusal(cart: DeviceCart, input: CheckoutInput): CartRefusal | null {
  if (cart.entries.length >= CART_MAX_ITEMS) return 'full'
  if (input.kind === 'haji') return 'hajiAlone'
  if (cart.entries.some(e => e.kind === 'haji')) return 'cartHasHaji'
  if (input.kind === 'visa' && cart.entries.filter(e => e.kind === 'visa').length >= cart.groups.length) return 'oneVisa'
  return null
}

/** Tambah entri. Satu rombongan: jumlah jamaah = yang terbanyak. Berrombongan: visa → rombongan pertama yang belum bervisa, lainnya → semua jamaah. */
export function addToCart(e: { kind: CheckoutKind; productId: string; title: string; input: CheckoutInput }): CartRefusal | null {
  const cart = readCart()
  const refusal = addRefusal(cart, e.input)
  if (refusal) return refusal
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  if (isGroupedCart(cart)) {
    const group = e.kind === 'visa' ? firstGroupWithoutVisa(cart) : -1
    write({ ...cart, entries: [...cart.entries, { id, ...e, ...(group >= 0 ? { group } : {}) }] })
    return null
  }
  const size = cart.entries.length === 0 ? entryPeople(e.input) : Math.max(cart.groups[0]!.size, entryPeople(e.input))
  write({ ...cart, groups: [{ ...cart.groups[0]!, size }], entries: [...cart.entries, { id, ...e }] })
  return null
}

export function removeFromCart(id: string) {
  const cart = readCart()
  write({ ...cart, entries: cart.entries.filter(e => e.id !== id) })
}

/** Jumlah jamaah keranjang satu rombongan. */
export function setCartPeople(people: number) {
  const cart = readCart()
  write({ ...cart, groups: [{ ...cart.groups[0]!, size: people }] })
}

/** Tambah rombongan (1 orang). Dari satu rombongan: rombongan lama jadi A dan visa yang ada ikut A. */
export function addCartGroup() {
  const cart = readCart()
  if (cartPeople(cart) >= CHECKOUT_MAX_PEOPLE || cart.groups.length >= CHECKOUT_MAX_PEOPLE) return
  const entries = isGroupedCart(cart) ? cart.entries : cart.entries.map(e => (e.kind === 'visa' ? { ...e, group: 0 } : e))
  write({ ...cart, groups: [...cart.groups, { size: 1, label: '' }], entries })
}

/** Hapus rombongan `g`: produknya beralih ke semua jamaah (visa ikut dihapus rujukannya); tinggal satu = kembali ke keranjang satu rombongan. */
export function removeCartGroup(g: number) {
  const cart = readCart()
  if (!isGroupedCart(cart)) return
  const groups = cart.groups.filter((_, i) => i !== g)
  const single = groups.length === 1
  const entries = cart.entries.map(e => {
    const { group, ...rest } = e
    if (single || group === undefined || group === g) return rest
    return { ...rest, group: group > g ? group - 1 : group }
  })
  write({ ...cart, groups, entries })
}

export function setCartGroup(g: number, patch: { size?: number; label?: string }) {
  const cart = readCart()
  write({ ...cart, groups: cart.groups.map((x, i) => (i === g ? { ...x, ...patch } : x)) })
}

/** Rombongan sasaran satu entri (undefined = semua jamaah). */
export function setEntryGroup(id: string, group: number | undefined) {
  const cart = readCart()
  write({ ...cart, entries: cart.entries.map(e => { if (e.id !== id) return e; const { group: _old, ...rest } = e; return group === undefined ? rest : { ...rest, group } }) })
}

export function clearCart() { write(EMPTY) }

/** Isi entri dengan jumlah orang sasarannya (rombongannya, atau semua jamaah) — dipakai badan permintaan DAN tampilan baris keranjang. */
export function entryInput(cart: DeviceCart, e: CartEntry): CheckoutInput {
  if (!isGroupedCart(cart)) return withPeople(e.input, cart.groups[0]!.size)
  const everyone = Math.min(cartPeople(cart), CHECKOUT_MAX_PEOPLE)
  return withPeople(e.input, e.group === undefined ? everyone : cart.groups[e.group]?.size ?? everyone)
}

/**
 * Isi keranjang → badan permintaan pesan/pratinjau (`checkoutCartSchema`). Satu rombongan: semua entri memakai jumlah jamaah keranjang. Berrombongan:
 * `groups` + `itemGroups`; jumlah orang entri diisi ukuran sasarannya (server tetap menurunkannya sendiri).
 */
export function cartBody(cart: DeviceCart): CheckoutCart | null {
  if (cart.entries.length === 0) return null
  if (!isGroupedCart(cart)) return { items: cart.entries.map(e => entryInput(cart, e)) }
  return {
    items: cart.entries.map(e => entryInput(cart, e)),
    groups: cart.groups.map(g => ({ size: g.size, ...(g.label.trim() ? { label: g.label.trim() } : {}) })),
    itemGroups: cart.entries.map(e => e.group ?? null),
  }
}
