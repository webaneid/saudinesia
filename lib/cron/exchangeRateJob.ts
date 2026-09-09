import cron from 'node-cron'
import { prisma } from '@/lib/db'
import { refreshAllVisaProductCaches } from '@/lib/pricing/refreshVisaProductCache'
import { refreshAllFlightScheduleCaches } from '@/lib/pricing/refreshFlightScheduleCache'
import { refreshAllHotelRoomScheduleCaches } from '@/lib/pricing/refreshHotelRoomScheduleCache'
import { refreshAllTransportPricingCaches } from '@/lib/pricing/refreshTransportPricingCache'
import { refreshAllMuthowifServicePriceCaches } from '@/lib/pricing/refreshMuthowifServicePriceCache'
import { refreshAllTourPackagePriceCaches } from '@/lib/pricing/refreshTourPackagePriceCache'
import { refreshAllPackagePriceCaches } from '@/lib/pricing/refreshPackagePriceCache'

const API_BASE = 'https://open.er-api.com/v6/latest'
const PAIRS: Array<{ from: string; to: string }> = [
  { from: 'USD', to: 'IDR' },
  { from: 'SAR', to: 'IDR' },
]

// Sementara hardcode — pindah ke setting admin (PricingRule/settings) di Fase 3, lihat docs/arsitektur-harga.md §9 Step 3
const DEFAULT_SPREAD_PERCENT = 1.5

// Sanity-check saja (SAR di-peg ke USD ~3.75 sejak 1986) — TIDAK dipakai untuk kalkulasi kurs.
// Lihat docs/arsitektur-harga.md §4.1 untuk alasan kenapa SAR tetap di-fetch langsung, bukan diturunkan dari peg ini.
const SAR_USD_PEG_APPROX = 3.75

type ExchangeRateApiResponse = {
  result: string
  rates: Record<string, number>
}

async function fetchLatestRates(baseCurrency: string): Promise<ExchangeRateApiResponse> {
  const res = await fetch(`${API_BASE}/${baseCurrency}`)
  if (!res.ok) throw new Error(`ExchangeRate API HTTP ${res.status} for base ${baseCurrency}`)
  const data = (await res.json()) as ExchangeRateApiResponse
  if (data.result !== 'success') throw new Error(`ExchangeRate API result="${data.result}" for base ${baseCurrency}`)
  return data
}

export async function refreshExchangeRates(): Promise<void> {
  const fetchedMidRates: Record<string, number> = {}
  const updatedCurrencies: string[] = []

  for (const { from, to } of PAIRS) {
    try {
      const data = await fetchLatestRates(from)
      const midRate = data.rates[to]
      if (typeof midRate !== 'number') {
        console.error(`[cron] ExchangeRate: tidak ada rate ${to} pada respons base ${from}`)
        continue
      }
      fetchedMidRates[from] = midRate

      const sellRate = midRate * (1 + DEFAULT_SPREAD_PERCENT / 100)
      await prisma.exchangeRate.create({
        data: {
          fromCurrency: from,
          toCurrency: to,
          midRate,
          spreadPercent: DEFAULT_SPREAD_PERCENT,
          sellRate,
          source: 'EXCHANGERATE_API',
        },
      })
      updatedCurrencies.push(from)
      console.log(`[cron] ExchangeRate ${from}->${to}: mid=${midRate} sell=${sellRate.toFixed(4)}`)
    } catch (err) {
      // Satu pasangan gagal tidak boleh menggagalkan yang lain — lihat docs/arsitektur-harga.md §4.2
      console.error(`[cron] ExchangeRate fetch gagal untuk ${from}->${to}:`, err)
    }
  }

  if (fetchedMidRates.USD && fetchedMidRates.SAR) {
    const impliedPeg = fetchedMidRates.USD / fetchedMidRates.SAR
    const deviation = Math.abs(impliedPeg - SAR_USD_PEG_APPROX) / SAR_USD_PEG_APPROX
    if (deviation > 0.02) {
      console.warn(
        `[cron] Sanity-check peg SAR/USD menyimpang: implied=${impliedPeg.toFixed(3)}, ekspektasi~${SAR_USD_PEG_APPROX} (deviasi ${(deviation * 100).toFixed(1)}%)`,
      )
    }
  }

  if (updatedCurrencies.length > 0) {
    try {
      await refreshAllVisaProductCaches(updatedCurrencies)
      console.log(`[cron] Cache harga visa di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllVisaProductCaches gagal:', err)
    }
    try {
      await refreshAllFlightScheduleCaches(updatedCurrencies)
      console.log(`[cron] Cache harga flight di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllFlightScheduleCaches gagal:', err)
    }
    try {
      await refreshAllHotelRoomScheduleCaches(updatedCurrencies)
      console.log(`[cron] Cache harga hotel di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllHotelRoomScheduleCaches gagal:', err)
    }
    try {
      await refreshAllTransportPricingCaches(updatedCurrencies)
      console.log(`[cron] Cache harga transport di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllTransportPricingCaches gagal:', err)
    }
    try {
      await refreshAllMuthowifServicePriceCaches(updatedCurrencies)
      console.log(`[cron] Cache harga muthowif di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllMuthowifServicePriceCaches gagal:', err)
    }
    try {
      await refreshAllTourPackagePriceCaches(updatedCurrencies)
      console.log(`[cron] Cache harga paket ziarah di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllTourPackagePriceCaches gagal:', err)
    }
    try {
      await refreshAllPackagePriceCaches(updatedCurrencies)
      console.log(`[cron] Cache harga paket umroh di-refresh untuk currency: ${updatedCurrencies.join(', ')}`)
    } catch (err) {
      console.error('[cron] refreshAllPackagePriceCaches gagal:', err)
    }
  }
}

export function startExchangeRateJob(): void {
  cron.schedule(
    '0 8,16 * * *',
    () => {
      void refreshExchangeRates()
    },
    { timezone: 'Asia/Jakarta' },
  )
  console.log('[cron] Exchange rate job scheduled (08:00 & 16:00 WIB)')
}
