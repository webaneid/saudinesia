// Payment config from env vars — no hardcoded bank accounts.
// Uses NEXT_PUBLIC_ so it works in both Server and Client Components.
// To change bank account → update .env only.

export type BankAccount = {
  bankName:      string
  accountNumber: string
  accountName:   string
}

/**
 * Nomor WhatsApp bisnis sebagai digit, atau '' bila belum diisi / masih placeholder (`628xxxxxxxxxx` → "628" bukan nomor): wajib 8–15 digit E.164.
 * Dipakai tautan verifikasi `wa.me` dan indikator panel admin — placeholder tak boleh dianggap "terisi".
 */
export function businessWaDigits(raw: string | undefined = process.env.NEXT_PUBLIC_BUSINESS_WA): string {
  const d = (raw ?? '').replace(/\D/g, '')
  return d.length >= 8 && d.length <= 15 && !/^0/.test(d) ? d : ''
}

export function getPaymentConfig(): {
  banks:           BankAccount[]
  businessName:    string
  businessWa:      string
  businessAddress: string
} {
  const businessName = process.env.NEXT_PUBLIC_BUSINESS_NAME ?? 'Saudinesia'

  const banks: BankAccount[] = []

  if (process.env.NEXT_PUBLIC_BANK_1_NAME) {
    banks.push({
      bankName:      process.env.NEXT_PUBLIC_BANK_1_NAME,
      accountNumber: process.env.NEXT_PUBLIC_BANK_1_NUMBER ?? '',
      accountName:   businessName,
    })
  }
  if (process.env.NEXT_PUBLIC_BANK_2_NAME) {
    banks.push({
      bankName:      process.env.NEXT_PUBLIC_BANK_2_NAME,
      accountNumber: process.env.NEXT_PUBLIC_BANK_2_NUMBER ?? '',
      accountName:   businessName,
    })
  }

  return {
    businessName,
    businessWa:      process.env.NEXT_PUBLIC_BUSINESS_WA ?? '',
    businessAddress: process.env.NEXT_PUBLIC_BUSINESS_ADDRESS ?? '',
    banks,
  }
}
