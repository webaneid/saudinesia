// Payment config from env vars — no hardcoded bank accounts.
// Uses NEXT_PUBLIC_ so it works in both Server and Client Components.
// To change bank account → update .env only.

export type BankAccount = {
  bankName:      string
  accountNumber: string
  accountName:   string
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
