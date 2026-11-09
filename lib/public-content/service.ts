import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { routing, type AppLocale } from '@/i18n/routing'
import { writeAudit } from '@/lib/invoice/audit'
import type { PageContentInput } from '@/lib/validators/publicContent'
import {
  EMPTY_OVERRIDES, PUBLIC_PAGES, PUBLIC_PAGE_KEYS, editableFields, linkSlots, linkTargetOptions,
  type PageOverrides, type PublicPageKey,
} from './pages'

// SATU-SATUNYA penulis `public_page_contents` (docs/arsitektur-frontend-publik.md §6.5 C3). Halaman dari registry kode (C7): baris dibuat bila belum ada,
// tak pernah dihapus; "kembalikan ke bawaan" = isi dikosongkan.

export type ContentServiceError = { ok: false; status: 400 | 409; message: string }

/** Bentuk isi tersimpan → `PageOverrides`, membuang apa pun yang tak dikenal (data lama/rusak tidak merusak halaman). */
export function parseStoredContent(page: PublicPageKey, raw: unknown): PageOverrides {
  if (!raw || typeof raw !== 'object') return EMPTY_OVERRIDES
  const r = raw as { text?: unknown; links?: unknown }
  const fields = new Set(editableFields(page).map(f => f.key))
  const slots = new Set(linkSlots(page).map(s => s.slot))
  const text: PageOverrides['text'] = {}
  if (r.text && typeof r.text === 'object') {
    for (const l of routing.locales) {
      const src = (r.text as Record<string, unknown>)[l]
      if (!src || typeof src !== 'object') continue
      const entries = Object.entries(src as Record<string, unknown>).filter((e): e is [string, string] => fields.has(e[0]) && typeof e[1] === 'string' && e[1].trim() !== '')
      if (entries.length) text[l] = Object.fromEntries(entries)
    }
  }
  const links: PageOverrides['links'] = {}
  if (r.links && typeof r.links === 'object') {
    for (const [slot, v] of Object.entries(r.links as Record<string, unknown>)) if (slots.has(slot) && (v === null || typeof v === 'string')) links[slot] = v
  }
  return { text, links }
}

/** Masukan tervalidasi Zod → isi bersih untuk halaman itu, atau galat 400 bila menyebut kolom/tombol yang tak ada. Teks kosong dibuang (= bawaan). */
export function normalizeInput(page: PublicPageKey, input: Pick<PageContentInput, 'text' | 'links'>): PageOverrides | ContentServiceError {
  const fields = new Set(editableFields(page).map(f => f.key))
  const slots = new Set(linkSlots(page).map(s => s.slot))
  const text: PageOverrides['text'] = {}
  for (const l of routing.locales) {
    const src = input.text[l as AppLocale]
    if (!src) continue
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(src)) {
      if (!fields.has(k)) return { ok: false, status: 400, message: `Kolom "${k}" tidak bisa diedit` }
      const t = v.trim()
      if (t) out[k] = t
    }
    if (Object.keys(out).length) text[l as AppLocale] = out
  }
  const links: PageOverrides['links'] = {}
  for (const [slot, v] of Object.entries(input.links)) {
    if (!slots.has(slot)) return { ok: false, status: 400, message: `Tombol "${slot}" tidak ada di halaman ini` }
    links[slot] = v
  }
  return { text, links }
}

/** Ringkasan jejak: hanya yang berubah, `{ "id:hero.title": [lama, baru] }` / `{ "link:hero.primary": [lama, baru] }`. */
export function contentChanges(before: PageOverrides, after: PageOverrides): Record<string, Prisma.InputJsonValue> {
  const flat = (o: PageOverrides) => {
    const m: Record<string, string | null> = {}
    for (const l of routing.locales) for (const [k, v] of Object.entries(o.text[l] ?? {})) m[`${l}:${k}`] = v
    for (const [k, v] of Object.entries(o.links)) m[`link:${k}`] = v
    return m
  }
  const a = flat(before)
  const b = flat(after)
  const out: Record<string, Prisma.InputJsonValue> = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = k in a ? a[k]! : '(bawaan)'
    const y = k in b ? b[k]! : '(bawaan)'
    if (x !== y) out[k] = [x ?? '(disembunyikan)', y ?? '(disembunyikan)']
  }
  return out
}

const toJson = (o: PageOverrides): Prisma.InputJsonValue => ({ text: o.text, links: o.links }) as Prisma.InputJsonValue

/** Memastikan setiap halaman registry punya baris (id dipakai foto hero). Idempoten. */
export async function ensurePageRows(): Promise<void> {
  await prisma.$transaction(PUBLIC_PAGE_KEYS.map(pageKey => prisma.publicPageContent.upsert({ where: { pageKey }, create: { pageKey }, update: {} })))
}

export async function listPagesForAdmin() {
  await ensurePageRows()
  const rows = await prisma.publicPageContent.findMany({ select: { id: true, pageKey: true, content: true, updatedAt: true } })
  const byKey = new Map(rows.map(r => [r.pageKey, r]))
  const images = await prisma.productImage.groupBy({ by: ['productId'], where: { productType: 'public_page', productId: { in: rows.map(r => r.id) } }, _count: true })
  const withImage = new Set(images.map(i => i.productId))
  return PUBLIC_PAGE_KEYS.map(page => {
    const row = byKey.get(page)!
    const o = parseStoredContent(page, row.content)
    const edited = routing.locales.reduce((n, l) => n + Object.keys(o.text[l] ?? {}).length, 0) + Object.keys(o.links).length
    return { page, id: row.id, label: PUBLIC_PAGES[page].label, path: PUBLIC_PAGES[page].path, edited, hasHeroImage: withImage.has(row.id), updatedAt: row.updatedAt.toISOString() }
  })
}

export async function getPageForAdmin(page: PublicPageKey) {
  await ensurePageRows()
  const row = await prisma.publicPageContent.findUniqueOrThrow({ where: { pageKey: page }, select: { id: true, content: true, updatedAt: true } })
  return {
    page,
    id: row.id,
    label: PUBLIC_PAGES[page].label,
    path: PUBLIC_PAGES[page].path,
    fields: editableFields(page),
    links: linkSlots(page),
    targets: linkTargetOptions(),
    content: parseStoredContent(page, row.content),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Simpan isi halaman: kunci baris, versi dicek di dalam kunci (409 bila basi), jejak di transaksi yang sama. Isi kosong = kembali ke bawaan. */
export async function savePageContent(page: PublicPageKey, input: PageContentInput, staffId: string): Promise<{ ok: true; updatedAt: string } | ContentServiceError> {
  const next = normalizeInput(page, input)
  if ('ok' in next) return next
  await ensurePageRows()
  return prisma.$transaction(async tx => {
    // $queryRaw: Prisma ORM tidak punya SELECT … FOR UPDATE.
    await tx.$queryRaw`SELECT 1 FROM public_page_contents WHERE "pageKey" = ${page} FOR UPDATE`
    const cur = await tx.publicPageContent.findUniqueOrThrow({ where: { pageKey: page }, select: { id: true, content: true, updatedAt: true } })
    if (new Date(input.expectedUpdatedAt).getTime() !== cur.updatedAt.getTime()) {
      return { ok: false as const, status: 409 as const, message: 'Isi halaman sudah diubah orang lain. Muat ulang dulu.' }
    }
    const before = parseStoredContent(page, cur.content)
    const changes = contentChanges(before, next)
    if (Object.keys(changes).length === 0) return { ok: true as const, updatedAt: cur.updatedAt.toISOString() }
    const row = await tx.publicPageContent.update({ where: { pageKey: page }, data: { content: toJson(next) }, select: { updatedAt: true } })
    await writeAudit(tx, staffId, 'public_page', cur.id, 'update', { page, changes })
    return { ok: true as const, updatedAt: row.updatedAt.toISOString() }
  })
}
