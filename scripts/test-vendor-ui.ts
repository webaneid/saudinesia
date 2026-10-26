// Penjaga menu Sistem → Vendor (ADR-0003, docs/arsitektur-vendor.md, Fase 3): tanpa database. Memeriksa SUMBER bahwa halaman dijaga superadmin, hanya
// SATU formulir vendor yang membuat vendor, halaman Pengaturan tidak lagi punya jalur vendor sendiri, menu terdaftar — dan perilaku murni
// pemetaan formulir → body API.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { formStateToBody, vendorToFormState, EMPTY_VENDOR_FORM, type VendorRecord } from '@/components/admin/vendor/types'
import { getAdminNavigation, LABEL_SEGMEN } from '@/lib/admin/navigation'

let failed = 0
async function t(name: string, fn: () => Promise<void> | void) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 6).join('\n     ')}`) }
}

const read = (p: string) => readFileSync(p, 'utf8')
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const VENDOR_PAGES = [
  'app/[locale]/admin/(protected)/system/vendors/page.tsx',
  'app/[locale]/admin/(protected)/system/vendors/new/page.tsx',
  'app/[locale]/admin/(protected)/system/vendors/[id]/page.tsx',
  'app/[locale]/admin/(protected)/system/vendors/categories/page.tsx',
]

await t('setiap halaman vendor memanggil requireAdminPage lalu menolak non-superadmin (SEC-52)', () => {
  for (const p of VENDOR_PAGES) {
    const src = read(p)
    assert.match(src, /await requireAdminPage\(locale\)/, `${p}: tanpa requireAdminPage`)
    assert.match(src, /SUPERADMIN_ROLES\.includes\(session\.role\)/, `${p}: tanpa pemeriksaan superadmin`)
    assert.match(src, /redirect\(/, `${p}: non-superadmin tidak dialihkan`)
    assert.ok(src.indexOf('requireAdminPage(') < src.search(/\b(listVendors|getVendor|listCategories)\(/), `${p}: data dibaca sebelum penjaga`)
  }
})

await t('hanya VendorForm yang membuat vendor (POST) — tidak ada formulir vendor kedua', () => {
  const hits = [...walk('app'), ...walk('components')].filter(f => {
    const src = read(f)
    return /['"`]\/api\/v1\/admin\/system\/vendors['"`]/.test(src) && /method:\s*['"]POST['"]|method:\s*vendor\s*\?\s*'PUT'\s*:\s*'POST'/.test(src)
  })
  assert.deepEqual(hits.map(f => f.replace(/\\/g, '/')), ['components/admin/vendor/VendorForm.tsx'])
})

await t('halaman Pengaturan tidak lagi punya vendor, kontak vendor, atau alamat vendor sendiri', () => {
  const src = read('app/[locale]/admin/(protected)/system/settings/page.tsx')
  assert.doesNotMatch(src, /vendor|syarikah/i)
  assert.doesNotMatch(src, /AddressPicker/)
})

await t('menu Sistem memuat Vendor dan breadcrumb berlabel', () => {
  const sistem = getAdminNavigation({ isManager: true, isSuperAdmin: true }).find(g => g.label === 'Sistem')
  assert.ok(sistem?.items.some(i => i.path === '/admin/system/vendors' && i.label === 'Vendor'))
  const manager = getAdminNavigation({ isManager: true, isSuperAdmin: false })
  assert.ok(!manager.some(g => g.items.some(i => i.path.startsWith('/admin/system/vendors'))), 'manager tidak boleh melihat menu vendor')
  assert.equal(LABEL_SEGMEN.vendors, 'Vendor')
  assert.equal(LABEL_SEGMEN.categories, 'Kategori')
})

const record = (over: Partial<VendorRecord> = {}): VendorRecord => ({
  id: 'v1', name: 'Hotel A', countryCode: 'SA', isActive: true, isSystem: false, contactName: null, phoneCountryCode: null, phone: null,
  whatsappCountryCode: null, whatsapp: null, email: null, website: null, notes: null, categories: [], address: null, ...over,
})

await t('formStateToBody: kode negara hanya dikirim bila nomornya ada; alamat kosong tidak dikirim', () => {
  const empty = formStateToBody({ ...EMPTY_VENDOR_FORM, name: ' Hotel A ', countryCode: 'SA', categoryIds: ['c1'] })
  assert.equal(empty.name, 'Hotel A')
  assert.equal(empty.phone, '')
  assert.equal(empty.phoneCountryCode, null, 'default ID tanpa nomor harus dibuang')
  assert.equal(empty.whatsappCountryCode, null)
  assert.ok(!('address' in empty))
  const filled = formStateToBody({
    ...EMPTY_VENDOR_FORM, name: 'H', countryCode: 'SA', categoryIds: ['c1'],
    contact: { phoneCountryCode: 'SA', phone: '501234567', whatsappCountryCode: 'SA', whatsapp: '', email: 'a@b.test' },
    address: { ...EMPTY_VENDOR_FORM.address, type: 'international', fullAddress: 'Jl. X', countryCode: 'SA' },
  })
  assert.equal(filled.phoneCountryCode, 'SA')
  assert.equal(filled.whatsappCountryCode, null, 'WhatsApp kosong tidak boleh membawa kode negara')
  assert.ok('address' in filled)
})

await t('vendorToFormState: vendor lama tanpa negara/kategori tidak membuat formulir rusak', () => {
  const s = vendorToFormState(record({ countryCode: null }))
  assert.equal(s.countryCode, null)
  assert.deepEqual(s.categoryIds, [])
  assert.equal(s.contact.phoneCountryCode, 'ID')
  const back = vendorToFormState(record({ phoneCountryCode: 'SA', phone: '501234567', whatsappCountryCode: 'SA', whatsapp: '501234567', categories: [{ id: 'c1', slug: 'hotel', name: 'Hotel', isActive: true }] }))
  assert.deepEqual(back.categoryIds, ['c1'])
  assert.equal(back.contact.whatsapp, '501234567')
})

if (failed) { console.log(`\n${failed} gagal`); process.exit(1) }
console.log('\nsemua lulus')
