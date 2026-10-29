'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { CreatePage } from '@/components/admin/shell/CreatePage'
import { useCreateEntity } from '@/components/admin/shell/useCreateEntity'
import { ContactPicker, EMPTY_CONTACT, type ContactValue } from '@/components/shared/ContactPicker'
import { AddressPicker, EMPTY_ADDRESS, type AddressValue } from '@/components/shared/AddressPicker'
import { e164FromCountry } from '@/lib/utils/phone'

// Tambah Pelanggan (docs/arsitektur-pelanggan.md §6). Akun lahir BELUM DIAKTIFKAN (tanpa password; admin tak pernah memasukkan password pelanggan): pemilik email
// membuat password lewat tautan undangan, lalu menyetujui kebijakan privasi sendiri di langkah "Lengkapi data".
export default function NewCustomerPage() {
  const { locale } = useParams() as { locale: string }
  const { saving, error, clearError, submit } = useCreateEntity(
    '/api/v1/admin/customers',
    (id, data) => `/${locale}/admin/customers/${id}?invite=${String(data.invite ?? 'none')}`,
    'Pelanggan gagal ditambahkan.',
  )
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [contact, setContact] = useState<ContactValue>(EMPTY_CONTACT)
  const [address, setAddress] = useState<AddressValue>(EMPTY_ADDRESS)
  const [sendInvite, setSendInvite] = useState(true)

  function onSubmit() {
    const phone = e164FromCountry(contact.phoneCountryCode, contact.phone)
    const whatsapp = e164FromCountry(contact.whatsappCountryCode, contact.whatsapp)
    return submit({
      fullName: fullName.trim(), email: email.trim(), sendInvite,
      ...(phone ? { phone } : {}), ...(whatsapp ? { whatsapp } : {}),
      ...(address.fullAddress.trim() ? { address } : {}),
    })
  }

  return (
    <CreatePage
      icon={UserPlus} title="Tambah Pelanggan" backHref={`/${locale}/admin/customers`} backLabel="Daftar Pelanggan"
      description="Membuat akun pelanggan. Akun belum bisa dipakai masuk sampai pemilik email membuat password lewat tautan undangan."
      onSubmit={onSubmit} saving={saving} canSubmit={fullName.trim().length >= 2 && /\S+@\S+\.\S+/.test(email)} error={error} submitLabel="Tambah Pelanggan"
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div><p className="mb-1 text-xs text-admin-muted">Nama lengkap</p><input className="admin-inp" autoFocus value={fullName} onChange={e => { clearError(); setFullName(e.target.value) }} /></div>
          <div><p className="mb-1 text-xs text-admin-muted">Email (identitas akun)</p><input type="email" className="admin-inp" autoComplete="off" value={email} onChange={e => { clearError(); setEmail(e.target.value) }} /></div>
        </div>

        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold text-admin-ink">Kontak <span className="font-normal text-admin-muted">(opsional — pelanggan melengkapinya sendiri bila kosong)</span></p>
          <ContactPicker value={contact} onChange={v => { clearError(); setContact(v) }} showEmail={false} />
        </div>

        <div className="space-y-2">
          <p className="m-0 text-xs font-semibold text-admin-ink">Alamat <span className="font-normal text-admin-muted">(opsional)</span></p>
          <AddressPicker value={address} onChange={v => { clearError(); setAddress(v) }} />
        </div>

        <label className="flex items-start gap-2 rounded-xl bg-admin-spot/60 p-3 text-[13px] text-admin-ink">
          <input type="checkbox" className="mt-0.5" checked={sendInvite} onChange={e => setSendInvite(e.target.checked)} />
          <span>
            Kirim email undangan sekarang
            <span className="block text-xs text-admin-muted">Berisi tautan membuat password (berlaku 7 hari). Tanpa ini, undangan bisa dikirim kapan saja dari halaman pelanggan.</span>
          </span>
        </label>
      </div>
    </CreatePage>
  )
}
