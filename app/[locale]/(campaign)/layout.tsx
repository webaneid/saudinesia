import { Plus_Jakarta_Sans } from 'next/font/google'

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
})

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={jakarta.variable}
      style={{
        minHeight: '100vh',
        background: `
          radial-gradient(1200px 600px at 80% -10%, rgba(17,168,146,0.05), transparent 60%),
          radial-gradient(900px 500px at -10% 110%, rgba(176,122,30,0.04), transparent 60%),
          #F7F5EF
        `,
      }}
    >
      {children}
    </div>
  )
}
