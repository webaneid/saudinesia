// Pesan galat tombol "tambah vendor cepat" di editor HPP produk. Halaman produk dipakai manager, tetapi menulis vendor
// (POST /admin/system/settings/vendors) hanya boleh superadmin — SEC-61(b). Tanpa pesan ini kegagalannya senyap.
export function vendorQuickAddError(status: number, serverError?: string | null): string {
  if (status === 401 || status === 403) {
    return 'Hanya superadmin yang dapat menambah vendor baru. Minta superadmin menambahkannya di Pengaturan Sistem, lalu pilih dari daftar.'
  }
  return serverError || 'Vendor gagal dibuat.'
}
