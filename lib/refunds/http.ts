import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { formatRupiah } from '@/lib/utils'
import type { RefundFailure } from '@/lib/refunds/service'

// Satu pemetaan kegagalan layanan refund → respons HTTP admin (route buat + aksi; §10.13).
export function refundFailureResponse(r: RefundFailure): NextResponse {
  switch (r.kind) {
    case 'not_found': return NextResponse.json(err('Tidak ditemukan'), { status: 404 })
    case 'conflict': return NextResponse.json(err('Status refund sudah berubah — muat ulang halaman'), { status: 409 })
    case 'over_limit': return NextResponse.json(err(r.max > 0 ? `Jumlah refund paling banyak ${formatRupiah(r.max)}` : 'Tidak ada dana yang dapat dikembalikan'), { status: 422 })
    case 'needs_account': return NextResponse.json(err('Akun kas tidak aktif atau tidak ditemukan'), { status: 422 })
    case 'needs_recipient': return NextResponse.json(err('Isi rekening tujuan pelanggan (bank, nomor, nama pemilik) — wajib kecuali dibayar tunai'), { status: 422 })
    case 'invalid_date': return NextResponse.json(err('Tanggal bayar tidak boleh di masa depan atau sebelum refund disetujui'), { status: 422 })
    case 'decision_pending': return NextResponse.json(err('Pembatalan ini ditahan/ditunda — putuskan dari kotak pembatalan di halaman booking'), { status: 409 })
  }
}
