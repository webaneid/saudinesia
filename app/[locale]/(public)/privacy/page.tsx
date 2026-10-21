import { AlertTriangle } from 'lucide-react'
import { getPaymentConfig } from '@/lib/constants/payment'
import { PRIVACY_POLICY_VERSION, PERSONAL_DATA_CATEGORIES } from '@/lib/constants/legal'

export default function PrivacyPolicyPage() {
  const { businessName, businessWa, businessAddress } = getPaymentConfig()

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Kebijakan Privasi</h1>
        <p className="text-sm text-muted-foreground mt-1">Versi {PRIVACY_POLICY_VERSION}</p>
      </div>

      <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-800">
          <strong>DRAFT — perlu review legal sebelum go-live.</strong> Halaman ini disusun sebagai
          kerangka awal kepatuhan UU Pelindungan Data Pribadi (UU PDP), belum diverifikasi oleh
          penasihat hukum {businessName}.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Data yang Kami Kumpulkan</h2>
        <p className="text-sm text-muted-foreground">
          Untuk memproses pemesanan Haji &amp; Umroh (visa, hotel, transportasi, muthowif, katering),
          kami mengumpulkan:
        </p>
        <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
          {PERSONAL_DATA_CATEGORIES.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Tujuan Pemrosesan</h2>
        <p className="text-sm text-muted-foreground">
          Data digunakan semata-mata untuk memproses pemesanan Anda: pengurusan visa, reservasi
          hotel/transportasi/muthowif, konfirmasi pembayaran, dan komunikasi terkait perjalanan
          (WhatsApp/email). Kami tidak menjual data pribadi Anda kepada pihak ketiga.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Penyimpanan &amp; Keamanan</h2>
        <p className="text-sm text-muted-foreground">
          Dokumen (paspor, KTP, KK, sertifikat vaksin) disimpan di penyimpanan privat, hanya dapat
          diakses lewat tautan sementara (presigned URL) yang kedaluwarsa otomatis. Data tidak
          pernah dicatat di log aplikasi.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Hak Anda Sebagai Subjek Data</h2>
        <p className="text-sm text-muted-foreground">
          Sesuai UU PDP, Anda berhak mengakses, memperbaiki, dan meminta penghapusan data pribadi
          Anda. Untuk permintaan hapus akun, gunakan tombol &quot;Ajukan Hapus Akun&quot; di halaman
          Profil Saya setelah masuk ke akun Anda. Permintaan diproses manual mengingat sebagian
          data (riwayat transaksi) wajib disimpan untuk kebutuhan hukum/pajak.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Kontak</h2>
        <p className="text-sm text-muted-foreground">
          {businessName}
          {businessAddress ? ` — ${businessAddress}` : ''}
          {businessWa ? ` — WhatsApp +${businessWa}` : ''}
        </p>
      </section>
    </div>
  )
}
