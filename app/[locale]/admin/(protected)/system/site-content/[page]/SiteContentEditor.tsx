'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Link2, PanelsTopLeft, RotateCcw } from 'lucide-react'
import { EditPage } from '@/components/admin/shell/EditPage'
import { useEditEntity } from '@/components/admin/shell/useEditEntity'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { MediaField } from '@/components/admin/media/MediaField'
import { FormField } from '@/components/admin/ui/FormField'
import { Tabs, tabId, tabPanelId } from '@/components/admin/ui/Tabs'
import { useConfirm } from '@/components/admin/ui/useConfirm'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'

// Editor Konten Situs (docs/arsitektur-frontend-publik.md §6.5 C6). Kolom dari server (diturunkan dari berkas pesan); teks bawaan jadi placeholder,
// kosong = bawaan. Tujuan tombol hanya dari daftar putih server. Simpan = isi lengkap + versi (409 bila basi).

type Locale = 'id' | 'en'
type Field = { key: string; group: string; defaults: Record<Locale, string>; multiline: boolean }
type Slot = { slot: string; labelKey: string; target: string }
type PageData = {
  page: string
  id: string
  label: string
  path: string
  fields: Field[]
  links: Slot[]
  targets: { value: string; label: string }[]
  content: { text: Partial<Record<Locale, Record<string, string>>>; links: Record<string, string | null> }
  updatedAt: string
}
type Form = { text: Record<Locale, Record<string, string>>; links: Record<string, string> }

const LOCALES: { id: Locale; label: string }[] = [{ id: 'id', label: 'Bahasa Indonesia' }, { id: 'en', label: 'English' }]
const GROUP_LABEL: Record<string, string> = {
  meta: 'SEO — tidak tampil di halaman, hanya di tab peramban dan hasil Google', hero: 'Hero', services: 'Pilih kebutuhan', packages: 'Paket Umroh', visa: 'Visa', hotels: 'Hotel',
  muthowif: 'Muthowif', steps: 'Cara kerja', facts: 'Fakta di hero', list: 'Daftar produk', card: 'Kartu produk', cta: 'Ajakan penutup (CTA)',
}
const LEAF_LABEL: Record<string, string> = {
  title: 'Judul', subtitle: 'Subjudul', description: 'Deskripsi', eyebrow: 'Label kecil di atas judul', primaryCta: 'Teks tombol utama',
  secondaryCta: 'Teks tombol kedua', button: 'Teks tombol', seeAll: 'Tautan "lihat semua"', featured: 'Label unggulan', priceFrom: 'Teks "harga mulai"',
  perPerson: 'Satuan per orang', addOns: 'Catatan komponen tambahan', empty: 'Pesan bila kosong', order: 'Teks tombol pesan', details: 'Teks tombol detail',
  apply: 'Teks tombol ajukan', perNight: 'Satuan per malam', perDay: 'Satuan per hari', oneInvoice: 'Fakta satu invoice',
}
const META_LABEL: Record<string, string> = { 'meta.title': 'Judul di tab peramban dan Google', 'meta.description': 'Deskripsi di hasil pencarian Google' }
const fieldLabel = (key: string) => {
  if (META_LABEL[key]) return META_LABEL[key]
  const parts = key.split('.').slice(1)
  const leaf = parts.at(-1) ?? key
  const named = LEAF_LABEL[leaf] ?? leaf
  return parts.length > 1 ? `${parts.slice(0, -1).join(' › ')} › ${named}` : named
}
const SLOT_LABEL: Record<string, string> = { 'hero.primary': 'Tombol utama hero', 'hero.secondary': 'Tombol kedua hero', 'cta.primary': 'Tombol CTA' }
/** Nilai pilihan tombol: '' = bawaan, HIDDEN = disembunyikan, selain itu kunci tujuan. Tujuan beranda ('') diberi nilai sendiri. */
const DEFAULT = ''
const HIDDEN = '__hidden'
const HOME = '__home'
const toChoice = (v: string | null | undefined) => (v === undefined ? DEFAULT : v === null ? HIDDEN : v === '' ? HOME : v)
const fromChoice = (v: string): string | null | undefined => (v === DEFAULT ? undefined : v === HIDDEN ? null : v === HOME ? '' : v)

function toForm(d: PageData): Form {
  return {
    text: { id: { ...(d.content.text.id ?? {}) }, en: { ...(d.content.text.en ?? {}) } },
    links: Object.fromEntries(d.links.map(s => [s.slot, toChoice(d.content.links[s.slot])])),
  }
}

export function SiteContentEditor({ page, locale }: { page: string; locale: string }) {
  const endpoint = `/api/v1/admin/system/site-content/${page}`
  const listHref = `/${locale}/admin/system/site-content`
  const { item, loading, missing, saving, error, notice, save } = useEditEntity<PageData>(endpoint, listHref)
  const [form, setForm] = useState<Form | null>(null)
  const [lang, setLang] = useState<Locale>('id')
  const { dirty, markClean } = useDirtyForm(form)
  const { ask, dialog } = useConfirm()

  useEffect(() => {
    if (item && !form) { const f = toForm(item); setForm(f); markClean(f) }
  }, [item, form, markClean])

  const groups = useMemo(() => {
    const m = new Map<string, Field[]>()
    for (const f of item?.fields ?? []) m.set(f.group, [...(m.get(f.group) ?? []), f])
    // SEO paling bawah: tidak tampil di halaman, jadi jangan jadi kolom pertama yang dikira judul hero.
    return [...m].sort(([a], [b]) => Number(a === 'meta') - Number(b === 'meta'))
  }, [item])

  if (missing) return <p className="text-sm text-admin-muted">Halaman tidak ditemukan.</p>
  if (loading || !item || !form) return <p className="text-sm text-admin-muted">{error ?? 'Memuat…'}</p>

  const filled = (l: Locale) => Object.values(form.text[l]).filter(v => v.trim()).length
  const setText = (key: string, value: string) => setForm(f => (f ? { ...f, text: { ...f.text, [lang]: { ...f.text[lang], [key]: value } } } : f))
  const setLink = (slot: string, value: string) => setForm(f => (f ? { ...f, links: { ...f.links, [slot]: value } } : f))

  const body = (f: Form) => ({
    text: Object.fromEntries(LOCALES.map(({ id }) => [id, Object.fromEntries(Object.entries(f.text[id]).filter(([, v]) => v.trim()))])),
    links: Object.fromEntries(Object.entries(f.links).flatMap(([slot, v]) => { const t = fromChoice(v); return t === undefined ? [] : [[slot, t]] })),
    expectedUpdatedAt: item.updatedAt,
  })

  async function submit(f: Form) {
    if (await save(body(f))) markClean(f)
  }

  async function reset() {
    const ok = await ask({
      title: 'Kembalikan ke teks bawaan?',
      body: 'Semua teks dan pilihan tombol halaman ini (kedua bahasa) kembali ke bawaan. Foto hero tidak ikut terhapus.',
      confirmLabel: 'Ya, kembalikan',
    })
    if (!ok) return
    const empty: Form = { text: { id: {}, en: {} }, links: Object.fromEntries(item!.links.map(s => [s.slot, DEFAULT])) }
    setForm(empty)
    await submit(empty)
  }

  const publicHref = `/${locale}${item.path ? `/${item.path}` : ''}`
  const targetOptions = [
    { id: HIDDEN, label: 'Sembunyikan tombol' },
    ...item.targets.map(t => ({ id: t.value === '' ? HOME : t.value, label: t.label })),
  ]

  return (
    <>
      <EditPage
        title={`Konten: ${item.label}`}
        description="Kolom kosong memakai teks bawaan (terlihat samar). Teks yang berisi angka atau harga otomatis tidak bisa diedit di sini."
        icon={PanelsTopLeft}
        backHref={listHref}
        backLabel="Konten Situs"
        onSubmit={() => submit(form)}
        saving={saving}
        canSubmit
        dirty={dirty}
        error={error}
        notice={notice}
        media={<MediaField productType="public_page" productId={item.id} label="Foto hero" />}
        mediaTitle="Foto Hero"
        sidebar={
          <>
            <MetaBox title="Tombol" icon={Link2} description="Tujuan tombol hero dan CTA. Teks tombol diubah di kolom kiri." collapsible={false}>
              <div className="grid gap-3">
                {item.links.map(s => {
                  const def = item.targets.find(t => t.value === s.target)?.label ?? s.target
                  return (
                    <FormField key={s.slot} label={SLOT_LABEL[s.slot] ?? s.slot} htmlFor={`slot-${s.slot}`}>
                      <ChoiceSelect
                        options={targetOptions}
                        value={form.links[s.slot] ?? DEFAULT}
                        onChange={v => setLink(s.slot, v)}
                        placeholder={`Bawaan: ${def}`}
                        ariaLabel={SLOT_LABEL[s.slot] ?? s.slot}
                        size="sm"
                      />
                    </FormField>
                  )
                })}
              </div>
            </MetaBox>
            <MetaBox title="Halaman" icon={ExternalLink} collapsible={false}>
              <div className="grid gap-2">
                <a href={publicHref} target="_blank" rel="noopener" className="admin-btn-ghost justify-center">
                  <ExternalLink className="size-4" aria-hidden /> Lihat halaman
                </a>
                <button type="button" onClick={reset} disabled={saving} className="admin-btn-ghost justify-center disabled:opacity-50">
                  <RotateCcw className="size-4" aria-hidden /> Kembalikan ke bawaan
                </button>
              </div>
            </MetaBox>
          </>
        }
      >
        <Tabs
          items={LOCALES.map(l => ({ id: l.id, label: l.label, count: filled(l.id) || undefined }))}
          value={lang}
          onChange={setLang}
          label="Bahasa"
        />
        <div id={tabPanelId(lang)} role="tabpanel" aria-labelledby={tabId(lang)} className="grid gap-6 pt-4">
          {groups.map(([group, fields]) => (
            <section key={group} className="grid gap-3">
              <h3 className="m-0 border-b border-admin-line pb-1.5 text-sm font-semibold uppercase tracking-wide text-admin-muted">
                {GROUP_LABEL[group] ?? group}
              </h3>
              {fields.map(f => {
                const id = `f-${lang}-${f.key}`
                const value = form.text[lang][f.key] ?? ''
                const props = {
                  id, value, placeholder: f.defaults[lang], maxLength: 400, className: 'admin-inp',
                  onChange: (e: { target: { value: string } }) => setText(f.key, e.target.value),
                }
                return (
                  <FormField key={id} label={fieldLabel(f.key)} htmlFor={id} hint={value.trim() ? undefined : 'Memakai teks bawaan'}>
                    {f.multiline ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}
                  </FormField>
                )
              })}
            </section>
          ))}
        </div>
      </EditPage>
      {dialog}
    </>
  )
}
