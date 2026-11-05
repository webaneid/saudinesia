// Analisis keterjangkauan statis (TypeScript checker): dari sekumpulan akar transaksi, ikuti setiap fungsi/konstanta milik proyek yang dirujuk,
// lalu laporkan rujukan ke klien `prisma` global. Sengaja berlebih (rujukan = dianggap dipanggil), supaya jalur yang tak dieksekusi uji pun tertangkap.
import ts from 'typescript'
import { join, relative } from 'node:path'

export type Hit = { at: string; via: string[]; text: string }
export type Root = { label: string; node: ts.Node }

export function loadProgram(root: string) {
  const cfgPath = join(root, 'tsconfig.json')
  const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, root)
  const program = ts.createProgram({ rootNames: cfg.fileNames, options: { ...cfg.options, noEmit: true } })
  return { program, checker: program.getTypeChecker() }
}

export function resolve(checker: ts.TypeChecker, id: ts.Node): ts.Symbol | undefined {
  const s = checker.getSymbolAtLocation(id)
  if (!s) return undefined
  return s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s
}

/** Simbol ekspor `prisma` dari lib/db/index.ts. */
export function prismaSymbol(program: ts.Program, checker: ts.TypeChecker, root: string): ts.Symbol {
  const sf = program.getSourceFile(join(root, 'lib/db/index.ts'))
  if (!sf) throw new Error('lib/db/index.ts tidak ditemukan')
  const mod = checker.getSymbolAtLocation(sf)
  const sym = mod && checker.getExportsOfModule(mod).find(s => s.name === 'prisma')
  if (!sym) throw new Error('ekspor prisma tidak ditemukan')
  return sym
}

const inProject = (root: string, d: ts.Node) => {
  const f = d.getSourceFile().fileName
  return f.startsWith(root) && !f.includes('/node_modules/')
}

/** Isi yang perlu ditelusuri dari satu deklarasi: badan fungsi/metode, inisialisasi konstanta atau properti. */
function bodyOf(d: ts.Declaration): ts.Node | undefined {
  if (ts.isFunctionLike(d)) return d
  if (ts.isVariableDeclaration(d)) {
    // Variabel lokal yang ditangkap callback (mis. `prepared` hasil kerja SEBELUM transaksi dibuka) sudah dihitung di luar transaksi: nilainya saja yang dipakai, jangan ditelusuri.
    // Yang ditelusuri: fungsi lokal, dan konstanta tingkat modul (registry adapter, dst.).
    const init = d.initializer
    if (!init) return undefined
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init
    return ts.isSourceFile(d.parent.parent.parent) ? init : undefined
  }
  if (ts.isPropertyAssignment(d) || ts.isPropertyDeclaration(d)) return d.initializer
  if (ts.isShorthandPropertyAssignment(d)) return undefined // nilainya = variabel yang dirujuk, ditelusuri lewat identifier-nya
  return undefined
}

/** Telusuri dari `roots`. `skip(symbol)` = batas penelusuran (mis. fungsi yang memang di luar transaksi, beralasan). */
export function findGlobalPrisma(checker: ts.TypeChecker, target: ts.Symbol, root: string, roots: Root[], skip: (s: ts.Symbol) => boolean = () => false): Hit[] {
  const hits = new Map<string, Hit>()
  const seen = new Set<ts.Node>()
  const walk = (start: ts.Node, via: string[]) => {
    if (seen.has(start)) return
    seen.add(start)
    const visit = (n: ts.Node): void => {
      if (ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return
      if (ts.isCallExpression(n)) {
        const callee = resolve(checker, ts.isPropertyAccessExpression(n.expression) ? n.expression.name : n.expression)
        for (const d of callee?.declarations ?? []) {
          if (!ts.isFunctionLike(d) || !inProject(root, d)) continue
          d.parameters.forEach((p, i) => {
            if (!p.initializer || !ts.isIdentifier(p.initializer) || resolve(checker, p.initializer) !== target) return
            if (n.arguments.length > i) return
            const sf = n.getSourceFile()
            const at = `${relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
            if (!hits.has(at)) hits.set(at, { at, via, text: `tanpa argumen db: ${n.getText().slice(0, 70)}` })
          })
        }
      }
      if (ts.isIdentifier(n)) {
        // `{ hotel }`: simbol di lokasi ini = properti; yang berisi kode = variabelnya.
        const s = ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n ? checker.getShorthandAssignmentValueSymbol(n.parent) : resolve(checker, n)
        if (s === target) {
          // `db = prisma` pada parameter bukan pemakaian: dinilai di tempat panggilan (argumen `db` dihilangkan = pemakaian global, lihat bawah).
          if (ts.isParameter(n.parent) && n.parent.initializer === n) return
          // `db === prisma` membandingkan identitas, bukan kueri.
          if (ts.isBinaryExpression(n.parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.parent.operatorToken.kind)) return
          const sf = n.getSourceFile()
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart())
          const at = `${relative(root, sf.fileName)}:${line + 1}`
          if (!hits.has(at)) hits.set(at, { at, via, text: n.parent.getText().slice(0, 80) })
        } else if (s && !skip(s)) {
          for (const d of s.declarations ?? []) {
            if (!inProject(root, d)) continue
            const b = bodyOf(d)
            if (b) walk(b, [...via, s.name])
          }
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(start)
  }
  for (const r of roots) walk(r.node, [r.label])
  return [...hits.values()]
}

/** Callback transaksi: `prisma.$transaction(fn)` dan `<namaPembungkus>(fn)`, di berkas yang lolos `want`. */
export function transactionRoots(program: ts.Program, root: string, want: (rel: string) => boolean, wrappers: string[] = ['withBookingCode']): Root[] {
  const out: Root[] = []
  for (const sf of program.getSourceFiles()) {
    const rel = relative(root, sf.fileName)
    if (rel.startsWith('..') || rel.includes('node_modules') || !want(rel)) continue
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const callee = n.expression
        const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : ''
        const fn = n.arguments[0]
        // Bentuk larik `$transaction([prisma.a.x(), …])` / `$transaction(xs.map(…))` bukan callback: kuerinya memang dibuat dari klien global lalu dijalankan di satu transaksi.
        if ((name === '$transaction' || wrappers.includes(name)) && fn && !ts.isArrayLiteralExpression(fn) && !ts.isCallExpression(fn)) {
          out.push({ label: `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`, node: fn })
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}
