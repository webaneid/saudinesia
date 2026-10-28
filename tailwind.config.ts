import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        jakarta: ['var(--font-jakarta)', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Admin UI Kit (docs/admin-ui-kit.md) — nilai di globals.css, satu-satunya tempat warna brand
        admin: {
          canvas:           'rgb(var(--admin-canvas) / <alpha-value>)',
          spot:             'rgb(var(--admin-spot) / <alpha-value>)',
          ink:              'rgb(var(--admin-ink) / <alpha-value>)',
          muted:            'rgb(var(--admin-muted) / <alpha-value>)',
          line:             'rgb(var(--brand-accent-dark) / 0.18)',
          'line-strong':    'rgb(var(--brand-accent-dark) / 0.34)',
          accent:           'rgb(var(--admin-accent) / <alpha-value>)',
          'accent-strong':  'rgb(var(--admin-accent-strong) / <alpha-value>)',
          'primary-medium': 'rgb(var(--admin-primary-medium) / <alpha-value>)',
          gold:             'rgb(var(--admin-gold) / <alpha-value>)',
          'gold-strong':    'rgb(var(--admin-gold-strong) / <alpha-value>)',
          danger:           'rgb(var(--admin-danger) / <alpha-value>)',
          warning:          'rgb(var(--admin-warning) / <alpha-value>)',
          ok:               'rgb(var(--admin-ok) / <alpha-value>)',
        },
      },
      // Skala opacity v3 tidak punya 12/14/15 — dipakai token status Admin UI Kit (bg-admin-ok/12, dst.)
      opacity: {
        '12': '0.12',
        '14': '0.14',
        '15': '0.15',
      },
      boxShadow: {
        admin: '0 4px 14px rgb(var(--brand-primary-dark) / 0.07)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}

export default config
