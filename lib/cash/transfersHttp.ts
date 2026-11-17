import { NextResponse } from 'next/server'
import { err } from '@/lib/validators'
import type { TransferFailure } from '@/lib/cash/transfers'

// Galat layanan transfer → HTTP (Fase 12b). Pesan untuk staf; tak memuat nama model/DB.
const MAP: Record<TransferFailure, [number, string]> = {
  same_account: [422, 'Akun asal dan tujuan harus berbeda.'],
  account_missing: [422, 'Akun tidak ditemukan (atau rekening yang dipilih sudah nonaktif).'],
  qris_account: [422, 'Akun QRIS tidak bisa dipakai untuk transfer — uang QRIS mengendap di rekening penampung.'],
  bad_destination: [422, 'Akun tujuan tidak bisa menerima transfer (rekening nonaktif atau akun gateway — gateway hanya bisa jadi akun asal).'],
  future_date: [422, 'Waktu transfer tidak boleh di masa depan.'],
  too_old: [422, 'Waktu transfer terlalu jauh ke belakang (maksimal satu tahun).'],
  not_found: [404, 'Transfer tidak ditemukan.'],
  already_void: [409, 'Transfer ini sudah dibatalkan.'],
}

export function transferFailureResponse(kind: TransferFailure): NextResponse {
  const [status, message] = MAP[kind]
  return NextResponse.json(err(message), { status })
}
