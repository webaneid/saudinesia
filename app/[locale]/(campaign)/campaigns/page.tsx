import type { Metadata } from 'next'
import { CampaignDashboard } from '@/components/campaigns/CampaignDashboard'

export const metadata: Metadata = {
  title: 'Campaign Dashboard',
}

export default function CampaignsPage() {
  return <CampaignDashboard />
}
