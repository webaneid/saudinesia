import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import { formatRupiah } from '@/lib/utils'
import type { PayoutFailure } from './payouts'

// Galat layanan pencairan → HTTP (Fase 13e-1). Pesan untuk staf admin (bahasa Indonesia), tanpa detail internal.
export function payoutFailureResponse(kind: PayoutFailure, balanceIdr?: number): NextResponse {
  switch (kind) {
    case 'future_date': return NextResponse.json(err('Waktu bayar tidak boleh di masa depan'), { status: 400 })
    case 'too_old': return NextResponse.json(err('Waktu bayar paling lama satu tahun ke belakang'), { status: 400 })
    case 'bad_cash_account': return NextResponse.json(err('Akun kas asal tidak sah (rekening nonaktif atau QRIS)'), { status: 422 })
    case 'recipient_changed': return NextResponse.json(err('Rekening tujuan baru saja diubah Platform Provider — muat ulang halaman dan periksa nomornya sebelum mencatat'), { status: 409 })
    case 'duplicate': return NextResponse.json(err('Pencairan dengan jumlah, tujuan, dan waktu bayar yang sama sudah tercatat'), { status: 409 })
    case 'recipient_unavailable': return NextResponse.json(err('Rekening tujuan tidak ada atau nonaktif'), { status: 422 })
    case 'over_balance': return NextResponse.json({ ...err(`Jumlah melebihi saldo bagi hasil (${formatRupiah(balanceIdr ?? 0)})`), meta: { balanceIdr } }, { status: 409 })
    case 'not_found': return NextResponse.json(err('Pencairan tidak ditemukan'), { status: 404 })
    case 'already_void': return NextResponse.json(err('Pencairan ini sudah dibatalkan'), { status: 409 })
  }
}
