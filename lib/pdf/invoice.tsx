import { existsSync } from 'fs'
import path from 'path'
import { Document, Page, View, Text, Image, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { InvoiceData } from '@/lib/pdf/invoiceData'

// Satu fungsi render generik atas bentuk seragam dari buildInvoiceData() (lib/pdf/invoiceData.ts). Kop, pajak, rekening, dan S&K berasal dari invoice BEKU
// (docs/arsitektur-booking-engine-v2.md §10.4 Fase 6a). Logo: logo Pengaturan Invoice (lib/pdf/logo.ts, dikirim pemanggil), selain itu public/logo.png, selain itu teks saja.
const LOGO_PATH = path.join(process.cwd(), 'public', 'logo.png')

const STATUS_COLOR: Record<string, string> = {
  'UNPAID':               '#b45309',
  'MENUNGGU KONFIRMASI':  '#1d4ed8',
  'LUNAS':                '#15803d',
  'DIBATALKAN':           '#6b7280',
}

function formatRupiahPdf(amount: number): string {
  return `Rp ${Math.round(amount).toLocaleString('id-ID')}`
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: 48, height: 48, marginBottom: 6, objectFit: 'contain' },
  businessName: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  mutedLine: { fontSize: 8, color: '#6b7280', marginBottom: 1 },
  invoiceTitle: { fontSize: 20, fontWeight: 700, textAlign: 'right', marginBottom: 4 },
  invoiceNumber: { fontSize: 9, color: '#6b7280', textAlign: 'right', marginBottom: 6 },
  statusBadge: { alignSelf: 'flex-end', paddingVertical: 3, paddingHorizontal: 8, borderRadius: 3 },
  statusText: { fontSize: 8, fontWeight: 700, color: '#ffffff' },
  divider: { borderBottomWidth: 1, borderBottomColor: '#e5e7eb', marginVertical: 16 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  metaLabel: { fontSize: 7, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 3 },
  metaBlock: { maxWidth: '48%' },
  buyerName: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  metaFieldRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2, minWidth: 160 },
  metaFieldLabel: { fontSize: 8, color: '#6b7280' },
  metaFieldValue: { fontSize: 8, fontWeight: 700 },
  amountDue: { fontSize: 12, fontWeight: 700, marginTop: 4 },
  table: { marginTop: 4 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1f2937', paddingBottom: 4, marginBottom: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#f3f4f6', paddingVertical: 6 },
  colItem:   { width: '28%', paddingRight: 8, fontWeight: 700 },
  colDesc:   { width: '38%', paddingRight: 8, color: '#6b7280', fontSize: 8 },
  colQty:    { width: '8%', textAlign: 'center' },
  colPrice:  { width: '13%', textAlign: 'right' },
  colTotal:  { width: '13%', textAlign: 'right', fontWeight: 700 },
  thText:    { fontSize: 7, textTransform: 'uppercase', color: '#6b7280' },
  totalsBlock: { alignSelf: 'flex-end', width: '45%', marginTop: 12 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { fontSize: 9, color: '#6b7280' },
  totalsValue: { fontSize: 9 },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: '#1f2937' },
  grandTotalLabel: { fontSize: 10, fontWeight: 700 },
  grandTotalValue: { fontSize: 10, fontWeight: 700 },
  balanceDueValue: { fontSize: 11, fontWeight: 700 },
  footer: { marginTop: 32, borderTopWidth: 1, borderTopColor: '#e5e7eb', paddingTop: 12 },
  footerTitle: { fontSize: 8, fontWeight: 700, marginBottom: 4 },
  footerLine: { fontSize: 8, color: '#4b5563', marginBottom: 2 },
  revision: { fontSize: 8, color: '#6b7280', textAlign: 'right', marginBottom: 4 },
  terms: { fontSize: 7, color: '#4b5563', lineHeight: 1.4 },
})

const pct = (n: number) => `${Number(n.toFixed(3))}%`.replace('.', ',')

function InvoiceDocument({ data, logo }: { data: InvoiceData; logo: Buffer | null }) {
  const company = data.company
  const businessName = company.name ?? 'Saudinesia'
  const logoSrc = logo ?? (existsSync(LOGO_PATH) ? LOGO_PATH : null)
  const statusColor = STATUS_COLOR[data.statusLabel] ?? '#6b7280'
  const balanceDueColor = data.balanceDue > 0 ? '#b91c1c' : '#15803d'

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            {logoSrc && <Image src={logoSrc} style={styles.logo} />}
            <Text style={styles.businessName}>{businessName}</Text>
            {company.address && <Text style={styles.mutedLine}>{company.address}</Text>}
            {company.phone && <Text style={styles.mutedLine}>Telp: {company.phone}</Text>}
            {company.email && <Text style={styles.mutedLine}>{company.email}</Text>}
            {company.website && <Text style={styles.mutedLine}>{company.website}</Text>}
            {company.taxId && <Text style={styles.mutedLine}>NPWP: {company.taxId}</Text>}
          </View>
          <View>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{data.invoiceNumber}</Text>
            {data.revision > 1 && <Text style={styles.revision}>Revisi ke-{data.revision}</Text>}
            <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
              <Text style={styles.statusText}>{data.statusLabel}</Text>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Bill To</Text>
            <Text style={styles.buyerName}>{data.buyer.name}</Text>
            {data.buyer.address && <Text style={styles.mutedLine}>{data.buyer.address}</Text>}
            {data.buyer.phone && <Text style={styles.mutedLine}>{data.buyer.phone}</Text>}
            {data.buyer.email && <Text style={styles.mutedLine}>{data.buyer.email}</Text>}
          </View>
          <View style={styles.metaBlock}>
            <View style={styles.metaFieldRow}>
              <Text style={styles.metaFieldLabel}>Kode Booking</Text>
              <Text style={styles.metaFieldValue}>{data.bookingCode}</Text>
            </View>
            <View style={styles.metaFieldRow}>
              <Text style={styles.metaFieldLabel}>Tanggal Invoice</Text>
              <Text style={styles.metaFieldValue}>{data.invoiceDate}</Text>
            </View>
            {data.balanceDue > 0 && data.dueDate && (
              <View style={styles.metaFieldRow}>
                <Text style={styles.metaFieldLabel}>Jatuh Tempo</Text>
                <Text style={styles.metaFieldValue}>{data.dueDate}</Text>
              </View>
            )}
            {data.balanceDue === 0 && data.paidDate && (
              <View style={styles.metaFieldRow}>
                <Text style={styles.metaFieldLabel}>Tanggal Lunas</Text>
                <Text style={styles.metaFieldValue}>{data.paidDate}</Text>
              </View>
            )}
            <Text style={[styles.amountDue, { textAlign: 'right', color: balanceDueColor }]}>{formatRupiahPdf(data.balanceDue)}</Text>
            <Text style={[styles.metaFieldLabel, { textAlign: 'right' }]}>Sisa Tagihan</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colItem, styles.thText]}>Item</Text>
            <Text style={[styles.colDesc, styles.thText]}>Deskripsi</Text>
            <Text style={[styles.colQty, styles.thText]}>Qty</Text>
            <Text style={[styles.colPrice, styles.thText]}>Harga</Text>
            <Text style={[styles.colTotal, styles.thText]}>Total</Text>
          </View>
          {data.lineItems.map((li, i) => (
            <View key={i} style={styles.tableRow} wrap={false}>
              <Text style={styles.colItem}>{li.label}</Text>
              <Text style={styles.colDesc}>{li.description}</Text>
              <Text style={styles.colQty}>{li.qty}</Text>
              <Text style={styles.colPrice}>{formatRupiahPdf(li.unitPrice)}</Text>
              <Text style={styles.colTotal}>{formatRupiahPdf(li.amount)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text style={styles.totalsValue}>{formatRupiahPdf(data.subtotal)}</Text>
          </View>
          {data.taxLines.map((t, i) => (
            <View key={i} style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>{t.name} {pct(t.ratePercent)}{t.basisPercent !== 100 ? ` × DPP ${pct(t.basisPercent)}` : ''}{t.mode === 'included' ? ' (termasuk)' : ''}</Text>
              <Text style={styles.totalsValue}>{formatRupiahPdf(t.amountIdr)}</Text>
            </View>
          ))}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total</Text>
            <Text style={styles.grandTotalValue}>{formatRupiahPdf(data.totalAmount)}</Text>
          </View>
          {data.paid > 0 && (
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Terbayar</Text>
              <Text style={styles.totalsValue}>{formatRupiahPdf(data.paid)}</Text>
            </View>
          )}
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Sisa Tagihan</Text>
            <Text style={[styles.balanceDueValue, { color: balanceDueColor }]}>{formatRupiahPdf(data.balanceDue)}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Cara Pembayaran</Text>
          {data.banks.map(b => (
            <Text key={`${b.bankName}-${b.accountNumber}`} style={styles.footerLine}>
              Transfer via Bank {b.bankName} — {b.accountNumber} a.n. {b.accountHolder}{b.branch ? ` (${b.branch})` : ''}
            </Text>
          ))}
          <Text style={[styles.footerLine, { marginTop: 4, fontStyle: 'italic' }]}>
            Pembayaran dianggap sah setelah dikonfirmasi oleh tim {businessName}.
          </Text>
        </View>

        {data.terms !== '' && (
          <View style={styles.footer}>
            <Text style={styles.footerTitle}>Syarat & Ketentuan</Text>
            <Text style={styles.terms}>{data.terms}</Text>
          </View>
        )}
        {data.footerNote !== '' && <Text style={[styles.terms, { marginTop: 12 }]}>{data.footerNote}</Text>}
      </Page>
    </Document>
  )
}

export async function generateInvoicePdf(data: InvoiceData, logo: Buffer | null = null): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} logo={logo} />)
}
