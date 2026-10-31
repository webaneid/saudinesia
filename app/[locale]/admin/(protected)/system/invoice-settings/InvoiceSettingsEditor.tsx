'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Banknote, Building2, Clock, FileText, Hash, Landmark, Percent, QrCode, ScrollText, Wallet } from 'lucide-react'
import { EditorShell } from '@/components/admin/editor/EditorShell'
import { MetaBox } from '@/components/admin/editor/MetaBox'
import { PublishBox } from '@/components/admin/editor/PublishBox'
import { useDirtyForm } from '@/components/admin/editor/useDirtyForm'
import { useUnsavedGuard } from '@/components/admin/editor/useUnsavedGuard'
import { MediaField } from '@/components/admin/media/MediaField'
import { Switch } from '@/components/admin/ui/Switch'
import { FormField } from '@/components/admin/ui/FormField'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { ChoiceSelect } from '@/components/shared/ChoiceSelect'
import { RichTextEditor } from '@/components/shared/rich-text/RichTextEditor'
import { formatInvoiceNumber } from '@/lib/invoice/numberPattern'
import { DATETIME_MEDIUM, DEFAULT_APP_TIMEZONE, dateInApp, formatInstant, zoneLabel } from '@/lib/time'
import type { InvoiceSettingsDto } from '@/lib/invoice/settings'
import { ListCrudBox } from './ListCrudBox'

// Bentuk formulir: angka disimpan sebagai TEKS supaya pengetikan "2." atau kolom kosong tak "dibetulkan" paksa; dikonversi saat simpan.
type Form = {
  numberPrefix: string; numberPattern: string; numberPadding: string; numberResetYearly: boolean
  appTimezone: string; defaultDueDays: string; expireDaysBeforeReference: string; minimumFirstPaymentPercent: string
  uniqueCodeEnabled: boolean; uniqueCodeMin: string; uniqueCodeMax: string
  methodBankTransfer: boolean; methodQris: boolean; methodIpaymu: boolean; methodXendit: boolean; gatewaySandbox: boolean
  ipaymuFeePercent: string; ipaymuFeeFlatIdr: string; xenditFeePercent: string; xenditFeeFlatIdr: string
  companyName: string; companyTaxId: string; companyPhone: string; companyEmail: string; companyWebsite: string
  termsDoc: string; footerNoteDoc: string
}
type State = { form: Form; address: AddressValue }

const str = (n: number) => String(n)
function toState(d: InvoiceSettingsDto): State {
  const a = d.companyAddress
  return {
    form: {
      numberPrefix: d.numberPrefix, numberPattern: d.numberPattern, numberPadding: str(d.numberPadding), numberResetYearly: d.numberResetYearly,
      appTimezone: d.appTimezone, defaultDueDays: str(d.defaultDueDays), expireDaysBeforeReference: str(d.expireDaysBeforeReference), minimumFirstPaymentPercent: str(d.minimumFirstPaymentPercent),
      uniqueCodeEnabled: d.uniqueCodeEnabled, uniqueCodeMin: str(d.uniqueCodeMin), uniqueCodeMax: str(d.uniqueCodeMax),
      methodBankTransfer: d.methodBankTransfer, methodQris: d.methodQris, methodIpaymu: d.methodIpaymu, methodXendit: d.methodXendit, gatewaySandbox: d.gatewaySandbox,
      ipaymuFeePercent: str(d.ipaymuFeePercent), ipaymuFeeFlatIdr: str(d.ipaymuFeeFlatIdr), xenditFeePercent: str(d.xenditFeePercent), xenditFeeFlatIdr: str(d.xenditFeeFlatIdr),
      companyName: d.companyName ?? '', companyTaxId: d.companyTaxId ?? '', companyPhone: d.companyPhone ?? '', companyEmail: d.companyEmail ?? '', companyWebsite: d.companyWebsite ?? '',
      termsDoc: d.termsDoc ?? '', footerNoteDoc: d.footerNoteDoc ?? '',
    },
    address: a ? { type: a.type, fullAddress: a.fullAddress, postalCode: a.postalCode ?? '', provinceId: a.provinceId, regencyId: a.regencyId, districtId: a.districtId, villageId: a.villageId, countryCode: a.countryCode, city: a.city ?? '', stateRegion: a.stateRegion ?? '' } : EMPTY_ADDRESS,
  }
}

const num = (s: string): number => (s.trim() === '' ? Number.NaN : Number(s.replace(',', '.')))
function toBody(f: Form, address: AddressValue, hadAddress: boolean, expectedUpdatedAt: string) {
  const hasAddress = address.fullAddress.trim() !== ''
  return {
    numberPrefix: f.numberPrefix, numberPattern: f.numberPattern, numberPadding: num(f.numberPadding), numberResetYearly: f.numberResetYearly,
    appTimezone: f.appTimezone, defaultDueDays: num(f.defaultDueDays), expireDaysBeforeReference: num(f.expireDaysBeforeReference), minimumFirstPaymentPercent: num(f.minimumFirstPaymentPercent),
    uniqueCodeEnabled: f.uniqueCodeEnabled, uniqueCodeMin: num(f.uniqueCodeMin), uniqueCodeMax: num(f.uniqueCodeMax),
    methodBankTransfer: f.methodBankTransfer, methodQris: f.methodQris, methodIpaymu: f.methodIpaymu, methodXendit: f.methodXendit, gatewaySandbox: f.gatewaySandbox,
    ipaymuFeePercent: num(f.ipaymuFeePercent), ipaymuFeeFlatIdr: num(f.ipaymuFeeFlatIdr), xenditFeePercent: num(f.xenditFeePercent), xenditFeeFlatIdr: num(f.xenditFeeFlatIdr),
    companyName: f.companyName, companyTaxId: f.companyTaxId, companyPhone: f.companyPhone, companyEmail: f.companyEmail, companyWebsite: f.companyWebsite,
    termsDoc: f.termsDoc, footerNoteDoc: f.footerNoteDoc, expectedUpdatedAt,
    ...(hasAddress ? { address } : hadAddress ? { address: null } : {}),
  }
}

function timezoneOptions(current: string) {
  const all = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []) as string[]
  const base = new Set(['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Riyadh', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Dubai', 'UTC', ...all, current])
  return [...base].map(id => ({ id, label: id.replace(/_/g, ' '), hint: zoneLabel(id) }))
}

type Bank = { id: string; bankName: string; accountNumber: string; accountHolder: string; branch: string | null; isActive: boolean; sortOrder: number }
type Qris = { id: string; name: string; emvPayload: string | null; isActive: boolean; sortOrder: number }
type Tax = { id: string; name: string; ratePercent: number; basisPercent: number; mode: 'added' | 'included'; isActive: boolean; sortOrder: number }

const inp = 'admin-inp'
function NumberInput({ id, value, onChange, suffix, step = '1' }: { id: string; value: string; onChange: (v: string) => void; suffix?: string; step?: string }) {
  return (
    <div className="flex items-center gap-2">
      <input id={id} className={inp} type="number" inputMode="decimal" step={step} value={value} onChange={e => onChange(e.target.value)} />
      {suffix && <span className="shrink-0 text-xs text-admin-muted">{suffix}</span>}
    </div>
  )
}
function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div><p className="m-0 text-sm font-medium text-admin-ink">{label}</p>{hint && <p className="m-0 text-[11px] text-admin-muted">{hint}</p>}</div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export function InvoiceSettingsEditor() {
  const [loaded, setLoaded] = useState<{ state: State; hadAddress: boolean; updatedAt: string } | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [banks, setBanks] = useState<Bank[]>([])
  const [qris, setQris] = useState<Qris[]>([])
  const { dirty, markClean } = useDirtyForm(form ? { form, address } : null)
  useUnsavedGuard(dirty)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/v1/admin/system/invoice-settings')
        const j: { data?: InvoiceSettingsDto; error?: string } | null = await r.json().catch(() => null)
        if (!r.ok || !j?.data) { setError(j?.error ?? 'Pengaturan gagal dimuat.'); return }
        const s = toState(j.data)
        setLoaded({ state: s, hadAddress: j.data.companyAddress !== null, updatedAt: j.data.updatedAt })
        setForm(s.form); setAddress(s.address); markClean(s)
      } catch { setError('Tidak dapat menghubungi server.') }
    })()
  }, [markClean])

  const patch = useCallback((p: Partial<Form>) => { setSaved(false); setForm(f => (f ? { ...f, ...p } : f)) }, [])
  const zones = useMemo(() => timezoneOptions(form?.appTimezone ?? DEFAULT_APP_TIMEZONE), [form?.appTimezone])

  async function save() {
    if (!form || !loaded) return
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/v1/admin/system/invoice-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toBody(form, address, loaded.hadAddress, loaded.updatedAt)) })
      const j: { data?: InvoiceSettingsDto; error?: string } | null = await r.json().catch(() => null)
      if (!r.ok || !j?.data) { setError(j?.error ?? 'Pengaturan gagal disimpan.'); return }
      const s = toState(j.data)
      setLoaded({ state: s, hadAddress: j.data.companyAddress !== null, updatedAt: j.data.updatedAt })
      setForm(s.form); setAddress(s.address); markClean(s); setSaved(true)
    } catch { setError('Tidak dapat menghubungi server.') } finally { setSaving(false) }
  }

  if (!form) {
    return <p role={error ? 'alert' : 'status'} className={error ? 'text-sm font-medium text-admin-danger' : 'text-sm text-admin-muted'}>{error ?? 'Memuat…'}</p>
  }

  const today = dateInApp(new Date(), form.appTimezone)
  const preview = formatInvoiceNumber(form.numberPattern, { prefix: form.numberPrefix, year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)), seq: 7, padding: Math.min(Math.max(num(form.numberPadding) || 4, 1), 10) })
  const warnings: string[] = []
  if (form.methodBankTransfer && !banks.some(b => b.isActive)) warnings.push('Transfer bank aktif tetapi belum ada rekening aktif.')
  if (form.methodQris && !qris.some(q => q.isActive)) warnings.push('QRIS aktif tetapi belum ada akun QRIS aktif.')
  if (form.methodIpaymu || form.methodXendit) warnings.push('Gateway disimpan sebagai setelan; pembayaran lewat iPaymu/Xendit baru tersedia pada fase berikutnya.')

  return (
    <EditorShell
      backHref="/admin/system/settings" backLabel="Pengaturan"
      title={<h1 className="m-0 text-2xl font-bold text-admin-ink">Pengaturan Invoice</h1>}
      banner={error ? <p role="alert" className="m-0 rounded-xl border border-admin-danger/30 bg-admin-danger/5 px-3 py-2 text-sm font-medium text-admin-danger">{error}</p> : undefined}
      main={
        <>
          <MetaBox title="Penomoran" icon={Hash} description="Nomor invoice berurut tanpa lompat. Pola memakai token {PREFIX} {YYYY} {YY} {MM} {SEQ}.">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Awalan" htmlFor="inv-prefix" hint="Huruf/angka, maksimal 12 karakter">
                <input id="inv-prefix" className={inp} maxLength={12} value={form.numberPrefix} onChange={e => patch({ numberPrefix: e.target.value })} />
              </FormField>
              <FormField label="Pola nomor" htmlFor="inv-pattern" hint="Wajib memuat {SEQ} tepat sekali">
                <input id="inv-pattern" className={inp} maxLength={60} value={form.numberPattern} onChange={e => patch({ numberPattern: e.target.value })} />
              </FormField>
              <FormField label="Panjang urut" htmlFor="inv-padding" hint="Jumlah digit (0007 = 4)">
                <NumberInput id="inv-padding" value={form.numberPadding} onChange={v => patch({ numberPadding: v })} />
              </FormField>
              <div className="self-end"><ToggleRow label="Urut diulang tiap tahun" hint="Pola harus memuat {YYYY} atau {YY}" checked={form.numberResetYearly} onChange={v => patch({ numberResetYearly: v })} /></div>
            </div>
          </MetaBox>

          <MetaBox title="Waktu & jatuh tempo" icon={Clock} description="Semua nilai hanya SARAN — admin bebas mengubahnya per invoice.">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Zona waktu aplikasi" htmlFor="inv-tz" hint="Dipakai untuk hari ini, batas hari, jatuh tempo, dan tampilan semua tanggal-jam.">
                <ChoiceSelect ariaLabel="Zona waktu aplikasi" value={form.appTimezone} onChange={v => patch({ appTimezone: v })} clearable={false} options={zones} />
              </FormField>
              <FormField label="Jatuh tempo bawaan" htmlFor="inv-due" hint="Hari sejak tanggal invoice; tidak mengikat">
                <NumberInput id="inv-due" value={form.defaultDueDays} onChange={v => patch({ defaultDueDays: v })} suffix="hari" />
              </FormField>
              <FormField label="Hangus bila belum ada uang masuk" htmlFor="inv-expire" hint="Hari sebelum tanggal acuan (item paling awal); 0 = nonaktif">
                <NumberInput id="inv-expire" value={form.expireDaysBeforeReference} onChange={v => patch({ expireDaysBeforeReference: v })} suffix="hari" />
              </FormField>
              <FormField label="Pembayaran pertama minimum" htmlFor="inv-minpay" hint="% dari tagihan; 0 = tanpa batas (hanya untuk pelanggan)">
                <NumberInput id="inv-minpay" value={form.minimumFirstPaymentPercent} onChange={v => patch({ minimumFirstPaymentPercent: v })} suffix="%" step="0.01" />
              </FormField>
            </div>
          </MetaBox>

          <TaxBox />

          <MetaBox title="Profil perusahaan" icon={Building2} description="Tampil di kop invoice.">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Nama perusahaan" htmlFor="co-name"><input id="co-name" className={inp} maxLength={160} value={form.companyName} onChange={e => patch({ companyName: e.target.value })} /></FormField>
              <FormField label="NPWP" htmlFor="co-tax"><input id="co-tax" className={inp} maxLength={40} value={form.companyTaxId} onChange={e => patch({ companyTaxId: e.target.value })} /></FormField>
              <FormField label="Telepon" htmlFor="co-phone"><input id="co-phone" className={inp} maxLength={40} value={form.companyPhone} onChange={e => patch({ companyPhone: e.target.value })} /></FormField>
              <FormField label="Email" htmlFor="co-email"><input id="co-email" className={inp} type="email" maxLength={160} value={form.companyEmail} onChange={e => patch({ companyEmail: e.target.value })} /></FormField>
              <FormField label="Situs web" htmlFor="co-web"><input id="co-web" className={inp} placeholder="https://" maxLength={200} value={form.companyWebsite} onChange={e => patch({ companyWebsite: e.target.value })} /></FormField>
            </div>
            <div className="border-t border-admin-line pt-3"><p className="mb-2 text-sm font-semibold text-admin-ink">Alamat</p><AddressPicker value={address} onChange={a => { setSaved(false); setAddress(a) }} /></div>
            <div className="border-t border-admin-line pt-3"><MediaField productType="invoice_settings" productId="global" label="Logo perusahaan" /></div>
          </MetaBox>

          <BankBox onChanged={setBanks} />
          <QrisBox onChanged={setQris} />

          <MetaBox title="Metode pembayaran" icon={Wallet} description="Yang aktif tampil di halaman bayar. Kunci API gateway disimpan di environment server, bukan di sini.">
            <ToggleRow label="Transfer bank" checked={form.methodBankTransfer} onChange={v => patch({ methodBankTransfer: v })} />
            <ToggleRow label="QRIS" checked={form.methodQris} onChange={v => patch({ methodQris: v })} />
            <ToggleRow label="iPaymu" hint="Payment gateway" checked={form.methodIpaymu} onChange={v => patch({ methodIpaymu: v })} />
            <ToggleRow label="Xendit" hint="Payment gateway" checked={form.methodXendit} onChange={v => patch({ methodXendit: v })} />
            <ToggleRow label="Mode uji (sandbox) gateway" checked={form.gatewaySandbox} onChange={v => patch({ gatewaySandbox: v })} />
            <div className="grid gap-3 border-t border-admin-line pt-3 sm:grid-cols-2">
              <FormField label="Biaya iPaymu (dibebankan ke pelanggan)" htmlFor="fee-ip" hint="Persen + biaya tetap per transaksi">
                <div className="grid grid-cols-2 gap-2">
                  <NumberInput id="fee-ip" value={form.ipaymuFeePercent} onChange={v => patch({ ipaymuFeePercent: v })} suffix="%" step="0.01" />
                  <NumberInput id="fee-ip-flat" value={form.ipaymuFeeFlatIdr} onChange={v => patch({ ipaymuFeeFlatIdr: v })} suffix="Rp" />
                </div>
              </FormField>
              <FormField label="Biaya Xendit (dibebankan ke pelanggan)" htmlFor="fee-xd" hint="Persen + biaya tetap per transaksi">
                <div className="grid grid-cols-2 gap-2">
                  <NumberInput id="fee-xd" value={form.xenditFeePercent} onChange={v => patch({ xenditFeePercent: v })} suffix="%" step="0.01" />
                  <NumberInput id="fee-xd-flat" value={form.xenditFeeFlatIdr} onChange={v => patch({ xenditFeeFlatIdr: v })} suffix="Rp" />
                </div>
              </FormField>
            </div>
            <div className="border-t border-admin-line pt-3">
              <ToggleRow label="Kode unik" hint="3 digit ditambahkan ke jumlah transfer/QRIS sebagai identitas transaksi (bukan kelebihan bayar)" checked={form.uniqueCodeEnabled} onChange={v => patch({ uniqueCodeEnabled: v })} />
              {form.uniqueCodeEnabled && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <FormField label="Kode minimum" htmlFor="uc-min"><NumberInput id="uc-min" value={form.uniqueCodeMin} onChange={v => patch({ uniqueCodeMin: v })} /></FormField>
                  <FormField label="Kode maksimum" htmlFor="uc-max"><NumberInput id="uc-max" value={form.uniqueCodeMax} onChange={v => patch({ uniqueCodeMax: v })} /></FormField>
                </div>
              )}
            </div>
          </MetaBox>

          <MetaBox title="Syarat & Ketentuan" icon={ScrollText} description="Tampil di invoice (aturan DP, pembatalan, dan lainnya).">
            <RichTextEditor id="inv-terms" title="Syarat & Ketentuan" value={form.termsDoc} onChange={termsDoc => patch({ termsDoc })} placeholder="Tulis syarat dan ketentuan pembayaran…" />
          </MetaBox>
          <MetaBox title="Catatan kaki invoice" icon={FileText} defaultOpen={form.footerNoteDoc !== ''}>
            <RichTextEditor id="inv-footer" title="Catatan kaki invoice" value={form.footerNoteDoc} onChange={footerNoteDoc => patch({ footerNoteDoc })} placeholder="Terima kasih atas kepercayaan Anda…" />
          </MetaBox>
        </>
      }
      sidebar={
        <>
          <PublishBox
            onSave={save} saving={saving} dirty={dirty} saved={saved && !dirty} canSave saveLabel="Simpan pengaturan"
            hint="Menyimpan isian di halaman ini. Daftar pajak, rekening bank, dan akun QRIS tersimpan langsung saat diubah."
            meta={loaded ? <>Terakhir diubah {formatInstant(loaded.updatedAt, DATETIME_MEDIUM)}</> : undefined}
          />
          <MetaBox title="Contoh nomor" icon={Hash} collapsible={false}>
            <p className="m-0 font-mono text-lg font-bold text-admin-accent-strong" aria-label="Contoh nomor invoice">{preview}</p>
            <p className="m-0 text-[11px] text-admin-muted">Urutan ke-7 pada tahun {today.slice(0, 4)} (zona {zoneLabel(form.appTimezone)}).</p>
          </MetaBox>
          {warnings.length > 0 && (
            <MetaBox title="Perlu diperhatikan" icon={AlertTriangle} collapsible={false}>
              <ul className="m-0 grid list-none gap-1.5 p-0 text-xs text-admin-warning">{warnings.map(w => <li key={w}>{w}</li>)}</ul>
            </MetaBox>
          )}
        </>
      }
    />
  )
}

function TaxBox() {
  return (
    <ListCrudBox<Tax, { name: string; ratePercent: string; basisPercent: string; mode: 'added' | 'included'; isActive: boolean; sortOrder: number }>
      title="Pajak" icon={Percent} noun="aturan pajak" apiBase="/api/v1/admin/system/tax-rules" emptyText="Belum ada aturan pajak (tanpa pajak)."
      description="Tampil di baris paling akhir invoice. Tarif 0 = tak dipakai. Harga katalog belum termasuk pajak, jadi bawaannya ditambahkan."
      summary={t => <><p className="m-0 font-semibold text-admin-ink">{t.name} — {t.ratePercent}%</p><p className="m-0 text-[11px] text-admin-muted">Dasar {t.basisPercent}% · {t.mode === 'added' ? 'ditambahkan ke harga' : 'sudah termasuk harga'}</p></>}
      blank={{ name: '', ratePercent: '0', basisPercent: '100', mode: 'added', isActive: true, sortOrder: 0 }}
      toForm={t => ({ name: t.name, ratePercent: String(t.ratePercent), basisPercent: String(t.basisPercent), mode: t.mode, isActive: t.isActive, sortOrder: t.sortOrder })}
      // Isian angka disimpan sebagai teks (agar bisa dikosongkan saat mengetik); server mengharapkan number — kosong dikirim null (ditolak "harus angka").
      toBody={f => ({ ...f, ratePercent: f.ratePercent.trim() === '' ? null : Number(f.ratePercent), basisPercent: f.basisPercent.trim() === '' ? null : Number(f.basisPercent) })}
      renderFields={(f, set) => (
        <>
          <FormField label="Nama pajak" htmlFor="tx-name" required><input id="tx-name" className={inp} maxLength={60} value={f.name} onChange={e => set({ name: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Tarif (%)" htmlFor="tx-rate"><NumberInput id="tx-rate" value={f.ratePercent} onChange={v => set({ ratePercent: v })} suffix="%" step="0.001" /></FormField>
            <FormField label="Dasar pengenaan (%)" htmlFor="tx-basis" hint="100 = dari seluruh harga"><NumberInput id="tx-basis" value={f.basisPercent} onChange={v => set({ basisPercent: v })} suffix="%" step="0.001" /></FormField>
          </div>
          <FormField label="Mode" htmlFor="tx-mode">
            <ChoiceSelect ariaLabel="Mode pajak" value={f.mode} onChange={v => set({ mode: v === 'included' ? 'included' : 'added' })} clearable={false} options={[{ id: 'added', label: 'Ditambahkan ke harga' }, { id: 'included', label: 'Sudah termasuk harga' }]} />
          </FormField>
          <ToggleRow label="Aktif" checked={f.isActive} onChange={v => set({ isActive: v })} />
        </>
      )}
    />
  )
}

function BankBox({ onChanged }: { onChanged: (rows: Bank[]) => void }) {
  return (
    <ListCrudBox<Bank, { bankName: string; accountNumber: string; accountHolder: string; branch: string; isActive: boolean; sortOrder: number }>
      title="Rekening bank" icon={Landmark} noun="rekening bank" apiBase="/api/v1/admin/system/bank-accounts" emptyText="Belum ada rekening."
      description="Tujuan transfer yang dipilih pelanggan di halaman bayar. Bila hanya ada satu rekening aktif, otomatis terpilih." onChanged={onChanged}
      summary={b => <><p className="m-0 font-semibold text-admin-ink">{b.bankName} · {b.accountNumber}</p><p className="m-0 text-[11px] text-admin-muted">a.n. {b.accountHolder}{b.branch ? ` · ${b.branch}` : ''}</p></>}
      blank={{ bankName: '', accountNumber: '', accountHolder: '', branch: '', isActive: true, sortOrder: 0 }}
      toForm={b => ({ bankName: b.bankName, accountNumber: b.accountNumber, accountHolder: b.accountHolder, branch: b.branch ?? '', isActive: b.isActive, sortOrder: b.sortOrder })}
      renderFields={(f, set) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nama bank" htmlFor="bk-name" required><input id="bk-name" className={inp} maxLength={80} value={f.bankName} onChange={e => set({ bankName: e.target.value })} /></FormField>
            <FormField label="Nomor rekening" htmlFor="bk-no" required><input id="bk-no" className={inp} inputMode="numeric" maxLength={40} value={f.accountNumber} onChange={e => set({ accountNumber: e.target.value })} /></FormField>
            <FormField label="Atas nama" htmlFor="bk-holder" required><input id="bk-holder" className={inp} maxLength={120} value={f.accountHolder} onChange={e => set({ accountHolder: e.target.value })} /></FormField>
            <FormField label="Cabang" htmlFor="bk-branch"><input id="bk-branch" className={inp} maxLength={120} value={f.branch} onChange={e => set({ branch: e.target.value })} /></FormField>
          </div>
          <ToggleRow label="Aktif" checked={f.isActive} onChange={v => set({ isActive: v })} />
        </>
      )}
    />
  )
}

function QrisBox({ onChanged }: { onChanged: (rows: Qris[]) => void }) {
  return (
    <ListCrudBox<Qris, { name: string; emvPayload: string; isActive: boolean; sortOrder: number }>
      title="QRIS" icon={QrCode} noun="akun QRIS" apiBase="/api/v1/admin/system/qris-accounts" emptyText="Belum ada akun QRIS." onChanged={onChanged}
      description="Akun QRIS statis. Unggah gambar + baca otomatis payload menyusul di fase QRIS dinamis; sementara payload dapat ditempel manual (diawali 000201)."
      summary={q => <><p className="m-0 font-semibold text-admin-ink">{q.name}</p><p className="m-0 text-[11px] text-admin-muted">{q.emvPayload ? `Payload tersimpan (${q.emvPayload.length} karakter)` : 'Belum ada payload'}</p></>}
      blank={{ name: '', emvPayload: '', isActive: true, sortOrder: 0 }}
      toForm={q => ({ name: q.name, emvPayload: q.emvPayload ?? '', isActive: q.isActive, sortOrder: q.sortOrder })}
      renderFields={(f, set) => (
        <>
          <FormField label="Nama akun" htmlFor="qr-name" required><input id="qr-name" className={inp} maxLength={80} value={f.name} onChange={e => set({ name: e.target.value })} /></FormField>
          <FormField label="Payload QRIS statis" htmlFor="qr-emv" hint="Teks hasil scan QRIS statis; boleh kosong dulu"><textarea id="qr-emv" className={`${inp} min-h-24 font-mono text-xs`} maxLength={2000} value={f.emvPayload} onChange={e => set({ emvPayload: e.target.value })} /></FormField>
          <ToggleRow label="Aktif" checked={f.isActive} onChange={v => set({ isActive: v })} />
        </>
      )}
    />
  )
}
