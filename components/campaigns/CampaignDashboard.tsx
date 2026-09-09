'use client'

import { useState, useMemo } from 'react'
import { Megaphone, BadgeCheck, FilePen, PiggyBank } from 'lucide-react'
import { CampaignSidebar } from './CampaignSidebar'
import { CampaignHeader, type TabId } from './CampaignHeader'
import { MetricCard, type MetricData } from './MetricCard'
import { FilterBar } from './FilterBar'
import { CampaignTable, type Campaign } from './CampaignTable'

const METRICS: MetricData[] = [
  {
    icon: Megaphone,
    tone: 'ink',
    label: 'Total Campaign',
    value: '3',
    sub: 'campaign terdaftar bulan ini',
    delta: '+1 minggu ini',
    deltaTone: 'mint',
    trend: [6, 8, 7, 9, 10, 11, 11, 12, 12, 13, 13, 14],
  },
  {
    icon: BadgeCheck,
    tone: 'mint',
    label: 'Campaign Aktif',
    value: '2',
    sub: 'sedang menerima donasi publik',
    delta: '67% dari total',
    deltaTone: 'mint',
    trend: [3, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 10],
  },
  {
    icon: FilePen,
    tone: 'teal',
    label: 'Masih Draft',
    value: '1',
    sub: 'menunggu review & publikasi',
    delta: 'Tinjau sekarang',
    deltaTone: 'teal',
    trend: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5],
  },
  {
    icon: PiggyBank,
    tone: 'amber',
    label: 'Target Terkurasi',
    value: 'Rp 1.000.000.000',
    sub: 'akumulasi target seluruh campaign',
    delta: 'Rp 0 terkumpul',
    deltaTone: 'muted',
    trend: [1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
]

const ALL_CAMPAIGNS: Campaign[] = [
  {
    id: 'cmp-001',
    title: 'Pengadaan Ambulans Sosial',
    sub: 'Pengadaan unit ambulans operasional 24 jam untuk warga prasejahtera di Bogor Selatan.',
    coverKind: 'amb',
    kategori: 'Layanan Sosial',
    status: 'DRAFT',
    goal: 500_000_000,
    collected: 0,
    updatedAt: '3 Apr 2026',
    updatedBy: 'Fadhil A.',
    donors: 0,
    daysLeft: 60,
  },
  {
    id: 'cmp-002',
    title: 'Renovasi Rumah Singgah Amanah',
    sub: 'Perbaikan atap, instalasi air bersih, dan sanitasi untuk 24 keluarga dampingan.',
    coverKind: 'rmh',
    kategori: 'Kesehatan',
    status: 'ACTIVE',
    goal: 250_000_000,
    collected: 0,
    updatedAt: '3 Apr 2026',
    updatedBy: 'Fadhil A.',
    donors: 0,
    daysLeft: 45,
  },
  {
    id: 'cmp-003',
    title: 'Bantu Renovasi Rumah Singgah Amanah',
    sub: 'Kampanye publik turunan untuk donasi terbuka mulai Rp 50.000.',
    coverKind: 'bnt',
    kategori: 'Tanpa kategori',
    status: 'ACTIVE',
    goal: 250_000_000,
    collected: 0,
    updatedAt: '3 Apr 2026',
    updatedBy: 'Fadhil A.',
    donors: 0,
    daysLeft: 45,
  },
]

export function CampaignDashboard() {
  const [tab, setTab] = useState<TabId>('all')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('Semua status')
  const [kategori, setKategori] = useState('Semua kategori')

  const rows = useMemo(() =>
    ALL_CAMPAIGNS.filter(r => {
      const qLower = q.toLowerCase()
      if (q && !r.title.toLowerCase().includes(qLower) && !r.kategori.toLowerCase().includes(qLower)) return false
      if (status !== 'Semua status' && r.status !== status) return false
      if (kategori !== 'Semua kategori' && r.kategori !== kategori) return false
      return true
    }),
  [q, status, kategori])

  const reset = () => {
    setQ('')
    setStatus('Semua status')
    setKategori('Semua kategori')
  }

  return (
    <div className="min-h-screen flex font-jakarta">
      <CampaignSidebar />
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="max-w-[1280px] mx-auto px-8 py-7">
          <CampaignHeader tab={tab} onTabChange={setTab} />

          {/* Metric cards */}
          <div className="mt-6 grid grid-cols-4 gap-4">
            {METRICS.map(m => <MetricCard key={m.label} m={m} />)}
          </div>

          {/* Filter bar */}
          <div className="mt-6">
            <FilterBar
              q={q}
              onQChange={setQ}
              status={status}
              onStatusChange={setStatus}
              kategori={kategori}
              onKategoriChange={setKategori}
              onReset={reset}
            />
          </div>

          {/* Data table */}
          <div className="mt-4">
            <CampaignTable rows={rows} />
          </div>

          {/* Page footer */}
          <div className="mt-8 mb-2 flex items-center justify-between text-[11.5px] text-slate-400">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-mint-600" />
              Semua perubahan tersimpan otomatis · v2.4.1
            </div>
            <div className="flex items-center gap-4">
              <a href="#" className="hover:text-ink transition-colors">Dokumentasi API</a>
              <a href="#" className="hover:text-ink transition-colors">Kebijakan Privasi</a>
              <a href="#" className="hover:text-ink transition-colors">Status sistem</a>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
