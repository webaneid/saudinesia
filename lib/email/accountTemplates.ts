import { renderEmail, type EmailContent } from '@/lib/email/templates'

// Email penghapusan akun (docs/arsitektur-hapus-akun.md §2.6). Dikirim ke alamat ASLI setelah commit; tanpa tautan, jadi tidak
// bergantung pada APP_URL. Tidak memakai notify(): setelah anonimisasi tidak ada lagi alamat yang boleh disimpan di NotificationLog.

export function accountDeletedEmail(name: string): EmailContent {
  return renderEmail({
    subject: 'Akun Saudinesia Anda telah dihapus',
    preheader: 'Permintaan penghapusan akun Anda sudah diproses.',
    heading: 'Akun Anda telah dihapus',
    paragraphs: [
      `Halo ${name}, permintaan penghapusan akun Saudinesia Anda sudah diproses.`,
      'Data pribadi Anda (profil, kontak, alamat, data dan dokumen jamaah) telah dihapus atau dianonimkan. Catatan transaksi (nomor booking, jumlah, tanggal) tetap kami simpan tanpa identitas Anda sesuai kewajiban hukum dan pajak.',
      'Anda bisa mendaftar kembali kapan saja dengan alamat email ini sebagai akun baru.',
    ],
    footnote: 'Bukan Anda yang mengajukan? Segera hubungi kami.',
  })
}

export function deletionRejectedEmail(name: string, note: string | null): EmailContent {
  return renderEmail({
    subject: 'Permintaan hapus akun Saudinesia Anda tidak dapat diproses',
    preheader: 'Akun Anda tetap aktif.',
    heading: 'Permintaan hapus akun belum dapat diproses',
    paragraphs: [
      `Halo ${name}, permintaan penghapusan akun Anda belum dapat kami proses dan akun Anda tetap aktif.`,
      ...(note ? [`Catatan dari tim kami: ${note}`] : []),
      'Hubungi kami bila Anda ingin mengajukan kembali.',
    ],
  })
}

/** Dikirim SAAT PENGAJUAN ke alamat akun (DEL-02): pemilik sah tahu, dan bisa membatalkan bila itu bukan dirinya. */
export function deletionRequestedEmail(name: string, waitHours: number): EmailContent {
  return renderEmail({
    subject: 'Kami menerima permintaan hapus akun Saudinesia Anda',
    preheader: 'Bukan Anda? Batalkan segera.',
    heading: 'Permintaan hapus akun diterima',
    paragraphs: [
      `Halo ${name}, kami menerima permintaan untuk menghapus akun Saudinesia Anda beserta data pribadi di dalamnya.`,
      `Permintaan diperiksa tim kami dan paling cepat diproses ${waitHours} jam setelah pengajuan. Selama itu Anda bisa membatalkannya dari halaman Profil.`,
      'Setelah diproses, penghapusan bersifat permanen: profil, kontak, alamat, serta data dan dokumen jamaah tidak dapat dipulihkan.',
    ],
    cta: { label: 'Buka Profil untuk membatalkan', path: '/id/profile' },
    footnote: 'Bukan Anda yang mengajukan? Segera batalkan di halaman Profil, ganti password Anda, dan hubungi kami.',
  })
}
