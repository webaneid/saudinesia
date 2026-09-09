export const waTemplates = {
  otp: (code: string) =>
    `*Saudinesia* — Kode OTP Anda: *${code}*\nBerlaku 5 menit. Jangan bagikan ke siapapun.`,

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
