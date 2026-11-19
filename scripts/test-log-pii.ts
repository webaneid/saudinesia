// Penjaga "tak ada data pribadi di log aplikasi" (docs/rencana-audit-golive.md §1, SEC-228; CLAUDE.md § Security).
// 1) `redactPii`/`errorSummary` menyamarkan pola PII dan membuang pesan galat validasi Prisma.
// 2) Galat Prisma SUNGGUHAN (klien `lib/db`) tak menuliskan email/nomor ke log — baik lewat `logError` maupun event `prisma:error` klien.
// 3) Pemindai sumber (AST, tanpa daftar hafalan): setiap `console.*` di kode server `app/`, `lib/`, `instrumentation*.ts`, `middleware.ts` tak boleh
//    mencetak objek galat mentah, `.message`/`.stack`, `JSON.stringify(...)`, atau nilai bernama kolom data pribadi.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { errorSummary, logError, redactPii } from '@/lib/log'

let failed = 0
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`PASS ${name}`) } catch (e) { failed++; console.log(`FAIL ${name}\n     ${(e as Error).message.split('\n').slice(0, 8).join('\n     ')}`) }
}

const EMAIL = 'rahasia.jamaah@example.test'
const PHONE = '6281234567890'

console.log('== redaksi ==')
await t('redactPii: email, HP (berbagai bentuk), NIK, token disamarkan; UUID, kode HTTP, angka pendek dibiarkan', () => {
  const s = redactPii(`kirim ke ${EMAIL} / +62 812-3456-7890 / 081234567890 / NIK 3171012345678901 / /id/invoice/${'a'.repeat(32)}.${'B'.repeat(43)} HTTP 500 booking 123e4567-e89b-12d3-a456-426614174000 percobaan 3/5 2026-11-19`)
  for (const leak of [EMAIL, '812-3456-7890', '081234567890', '3171012345678901', 'a'.repeat(32)]) assert.ok(!s.includes(leak), `bocor: ${leak} → ${s}`)
  for (const keep of ['HTTP 500', '123e4567-e89b-12d3-a456-426614174000', 'percobaan 3/5', '2026-11-19']) assert.ok(s.includes(keep), `hilang: ${keep} → ${s}`)
})

await t('errorSummary: nama + kode + pesan tersamar + lokasi; non-Error aman', () => {
  const e = Object.assign(new Error(`gagal untuk ${EMAIL}`), { code: 'E42' })
  const s = errorSummary(e)
  assert.match(s, /^Error \[E42\]: gagal untuk \[email\]/); assert.match(s, / \| at /); assert.ok(!s.includes(EMAIL))
  assert.equal(errorSummary({ email: EMAIL }), 'galat non-Error (object)')
  assert.equal(errorSummary(null), 'galat non-Error (null)')
})

console.log('== galat Prisma sungguhan ==')
const dbUrl = process.env.DATABASE_URL ?? ''
if (!/test|_ci|tmp/.test(dbUrl.split('/').pop() ?? '')) {
  console.log('SKIP galat Prisma sungguhan: DATABASE_URL bukan database sekali pakai')
} else {
  const { prisma } = await import('@/lib/db')
  const captured: string[] = []
  const orig = { error: console.error, warn: console.warn }
  const grab = (...a: unknown[]) => { captured.push(a.map(String).join(' ')) }
  console.error = grab; console.warn = grab
  try {
    let caught: unknown
    try { await prisma.user.create({ data: { email: EMAIL, phone: PHONE, fullName: 'Siti Contoh', passwordHash: 'x', bogus: 1 } as never }) } catch (e) { caught = e }
    await t('galat validasi Prisma: pesan aslinya memuat data (bukti), ringkasannya tidak', () => {
      assert.ok(caught instanceof Error && caught.message.includes(EMAIL), 'prasyarat: pesan Prisma memuat email')
      logError('uji', caught)
      const line = captured.at(-1) ?? ''
      assert.match(line, /^\[uji\] PrismaClientValidationError: validasi Prisma gagal \(prisma\.user\.create\)/)
      assert.ok(!line.includes(EMAIL) && !line.includes(PHONE) && !line.includes('Siti'), line)
    })
    await t('klien lib/db tak mencetak argumen query sendiri (event prisma:error tersamar)', () => {
      const all = captured.join('\n')
      assert.ok(!all.includes(EMAIL) && !all.includes(PHONE), all)
    })
  } finally {
    console.error = orig.error; console.warn = orig.warn
    await prisma.$disconnect()
  }
}

console.log('== pemindai sumber ==')
const ROOTS = ['app', 'lib', 'instrumentation.ts', 'instrumentation-node.ts', 'middleware.ts']
function walk(p: string, out: string[]) {
  let st; try { st = statSync(p) } catch { return }
  if (st.isDirectory()) { for (const f of readdirSync(p)) walk(join(p, f), out); return }
  if (/\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts')) out.push(p)
}
const files: string[] = []
for (const r of ROOTS) walk(r, files)

const PII_NAME = /\b(email|phone|whatsapp|fullName|full_name|nik|passport\w*|fieldValues|recipient|address|body|payload|password\w*|token|link)\b/i
const RAW_ERROR = /^(e|err|error|reason|cause|ex|exc)$/
const SAFE_CALL = /^(errorSummary|redactPii|prismaEventSummary)$/

/** Alasan argumen log ini berbahaya, atau null bila aman. */
function problem(node: ts.Expression, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isNumericLiteral(node)) return null
  if (ts.isTemplateExpression(node)) {
    for (const span of node.templateSpans) { const p = problem(span.expression, sf); if (p) return p }
    return null
  }
  if (ts.isCallExpression(node)) {
    const callee = node.expression.getText(sf)
    if (SAFE_CALL.test(callee)) return null
    if (callee === 'JSON.stringify') return 'JSON.stringify di log'
    for (const a of node.arguments) { const p = problem(a, sf); if (p) return p }
    return ts.isPropertyAccessExpression(node.expression) ? problem(node.expression.expression, sf) : null
  }
  if (ts.isIdentifier(node)) {
    if (RAW_ERROR.test(node.text)) return `objek galat mentah \`${node.text}\``
    if (PII_NAME.test(node.text)) return `nilai bernama data pribadi \`${node.text}\``
    return null
  }
  if (ts.isPropertyAccessExpression(node)) {
    const name = node.name.text
    if (name === 'message' || name === 'stack') return `\`.${name}\` galat`
    if (PII_NAME.test(name)) return `nilai bernama data pribadi \`.${name}\``
    return null
  }
  if (ts.isConditionalExpression(node)) return problem(node.whenTrue, sf) ?? problem(node.whenFalse, sf)
  if (ts.isBinaryExpression(node)) return problem(node.left, sf) ?? problem(node.right, sf)
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return problem(node.expression, sf)
  if (ts.isElementAccessExpression(node)) return problem(node.expression, sf)
  if (ts.isArrowFunction(node)) return ts.isBlock(node.body) ? 'fungsi berblok di argumen log' : problem(node.body, sf)
  return `argumen log tak dikenal (${ts.SyntaxKind[node.kind]}) — pakai logError/redactPii`
}

const violations: string[] = []
let scanned = 0
for (const f of files) {
  if (f.startsWith('lib/log/')) continue
  const text = readFileSync(f, 'utf8')
  if (/^\s*['"]use client['"]/.test(text)) continue // konsol peramban, bukan log server
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, f.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.expression.getText(sf) === 'console') {
      scanned++
      // Pengecualian beralasan di baris yang sama: `// log-pii-ok: <alasan>` (mis. tautan auth yang HANYA dicetak di NODE_ENV === 'development').
      const line = text.split('\n')[sf.getLineAndCharacterOfPosition(n.getStart()).line] ?? ''
      if (/\/\/ log-pii-ok: \S/.test(line)) { ts.forEachChild(n, visit); return }
      for (const a of n.arguments) {
        const p = problem(a, sf)
        if (p) violations.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${p}`)
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
}

await t(`setiap console.* server (${scanned} panggilan) bebas objek galat mentah, .message, JSON.stringify, dan nilai data pribadi`, () => {
  assert.ok(scanned > 20, 'pemindai tak menemukan panggilan — jalur salah?')
  assert.deepEqual(violations, [])
})

await t('pemindai mengenali pelanggaran (uji mutan)', () => {
  const src = "console.error('[x]', e); console.error(`[x] ${err.message}`); console.log(`[x] ${user.email}`); console.log(JSON.stringify(body)); console.error('[x]', errorSummary(e))"
  const sf = ts.createSourceFile('m.ts', src, ts.ScriptTarget.Latest, true)
  const found: string[] = []
  const visit = (n: ts.Node) => { if (ts.isCallExpression(n) && n.expression.getText(sf).startsWith('console.')) for (const a of n.arguments) { const p = problem(a, sf); if (p) found.push(p) } ts.forEachChild(n, visit) }
  visit(sf)
  assert.equal(found.length, 4, found.join(' | '))
})

await t('klien Prisma memancarkan galat sebagai event (bukan stdout) dan mencatatnya lewat prismaEventSummary', () => {
  const db = readFileSync('lib/db/index.ts', 'utf8')
  assert.match(db, /emit: 'event', level: 'error'/); assert.doesNotMatch(db, /log:\s*\[\s*'error'/); assert.match(db, /\$on\('error'.*prismaEventSummary/)
})

console.log(failed === 0 ? '\nSEMUA LULUS' : `\n${failed} GAGAL`)
process.exit(failed === 0 ? 0 : 1)
