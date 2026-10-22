// Template yang TIDAK dipakai saat ini (lingkup WhatsApp diperkecil — waMessage di lib/notifications/events.ts hanya memakai bookingSubmitted, paymentReminder,
// paymentConfirmed, paymentRejected + dua balasan verifikasi): autoCancelled, visaStatusChange, departureReminder, refundApproved. Sengaja dipertahankan untuk
// dibuka kembali saat WhatsApp dipakai lagi (ADR-0001); hapus bila keputusan itu berubah.
export const waTemplates = {
  // Balasan atas pesan verifikasi yang DIKIRIM PENGGUNA sendiri (percakapan dimulai pengguna — bukan pesan tak diminta).
  whatsappVerified: (maskedEmail: string) =>
    `Nomor WhatsApp Anda sudah terverifikasi untuk akun ${maskedEmail}. Notifikasi pesanan dan pembayaran Saudinesia akan dikirim ke nomor ini, selain lewat email.\n\nBukan akun Anda? Hubungi kami segera.`,

  whatsappTaken: () =>
    `Nomor ini sudah terverifikasi pada akun Saudinesia lain, sehingga tidak bisa dipakai untuk akun ini. Notifikasi tetap dikirim lewat email. Hubungi kami bila perlu bantuan.`,

  bookingSubmitted: (code: string, deadline: string) =>
    `Booking *${code}* berhasil dibuat.\nSelesaikan pembayaran sebelum: *${deadline}*\n\nLihat detail di aplikasi Saudinesia.`,

  paymentReminder: (code: string, deadline: string) =>
    `Reminder: Pembayaran booking *${code}* belum kami terima.\nBatas waktu: *${deadline}*\n\nSegera lakukan pembayaran agar booking tidak dibatalkan.`,

  paymentConfirmed: (code: string) =>
    `Pembayaran booking *${code}* telah dikonfirmasi. Terima kasih!\n\nDokumen perjalanan akan kami kirimkan segera setelah visa diproses.`,

  paymentRejected: (code: string) =>
    `Bukti pembayaran untuk booking *${code}* tidak dapat diverifikasi.\nMohon upload ulang bukti transfer yang jelas.`,

  autoCancelled: (code: string) =>
    `Booking *${code}* dibatalkan otomatis karena pembayaran tidak diterima dalam 24 jam.\n\nHubungi kami jika ada pertanyaan.`,

  visaStatusChange: (code: string, status: string) =>
    `Update visa untuk booking *${code}*:\nStatus: *${status}*\n\nLihat detail di aplikasi Saudinesia.`,

  departureReminder: (code: string, days: number) =>
    `Persiapkan diri Anda! Keberangkatan booking *${code}* ${days === 1 ? 'besok' : `${days} hari lagi`}.\n\nSemoga perjalanan ibadah Anda lancar dan mabrur.`,

  refundApproved: (code: string, amount: string) =>
    `Refund untuk booking *${code}* sebesar *${amount}* telah disetujui.\nProses transfer akan selesai dalam 3-5 hari kerja.`,
}
