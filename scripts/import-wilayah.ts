// Impor data wilayah resmi Kemendagri dari cahyadsn/wilayah (docs/arsitektur-alamat.md §4).
// One-off — jalankan manual (`bun scripts/import-wilayah.ts`) saat build data awal atau ada
// revisi Kepmendagri baru. BUKAN bagian prisma/seed.ts (data referensi ini tidak berubah tiap seed).
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const BATCH_SIZE = 5000

type Row = { code: string; name: string }

function parseWilayahSql(sqlPath: string): Row[] {
  const sql = readFileSync(sqlPath, 'utf-8')
  const rows: Row[] = []
  // Baris data: ('11.01.01.2001','Keude Bakongan'), — apostrof dieskep gaya SQL standar ('') bukan backslash,
  // mis. ('11.01.02.2018','Pasi Kuala Ba''u')
  const rowPattern = /\('([0-9.]+)','((?:[^']|'')*)'\)/g
  let match: RegExpExecArray | null
  while ((match = rowPattern.exec(sql)) !== null) {
    rows.push({ code: match[1]!, name: match[2]!.replace(/''/g, "'") })
  }
  return rows
}

function level(code: string): number {
  return code.split('.').length
}

function parentCode(code: string): string {
  return code.split('.').slice(0, -1).join('.')
}

function regencyType(name: string): string {
  if (name.startsWith('Kota ')) return 'kota'
  if (name.startsWith('Kabupaten ')) return 'kabupaten'
  throw new Error(`Nama kab/kota tanpa prefix dikenali: "${name}"`)
}

async function batchCreate<T>(label: string, rows: T[], create: (chunk: T[]) => Promise<{ count: number }>) {
  let inserted = 0
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE)
    const result = await create(chunk)
    inserted += result.count
  }
  console.log(`✓ ${label}: ${inserted} baris`)
}

async function main() {
  console.log('📍 Impor data wilayah Indonesia...\n')

  const sqlPath = fileURLToPath(new URL('./data/wilayah.sql', import.meta.url))
  const rows = parseWilayahSql(sqlPath)
  console.log(`Total baris terparse: ${rows.length}`)

  const provinces = rows.filter(r => level(r.code) === 1)
  const regencies = rows.filter(r => level(r.code) === 2)
  const districts = rows.filter(r => level(r.code) === 3)
  const villages = rows.filter(r => level(r.code) === 4)
  console.log(`Provinsi: ${provinces.length} · Kab/Kota: ${regencies.length} · Kecamatan: ${districts.length} · Desa/Kelurahan: ${villages.length}\n`)

  // Urutan wajib: parent dulu sebelum anak (FK)
  await batchCreate('Provinsi', provinces, chunk =>
    prisma.addressProvince.createMany({
      data: chunk.map(r => ({ id: r.code, name: r.name })),
      skipDuplicates: true,
    }))

  await batchCreate('Kab/Kota', regencies, chunk =>
    prisma.addressRegency.createMany({
      data: chunk.map(r => ({ id: r.code, provinceId: parentCode(r.code), name: r.name, type: regencyType(r.name) })),
      skipDuplicates: true,
    }))

  await batchCreate('Kecamatan', districts, chunk =>
    prisma.addressDistrict.createMany({
      data: chunk.map(r => ({ id: r.code, regencyId: parentCode(r.code), name: r.name })),
      skipDuplicates: true,
    }))

  await batchCreate('Desa/Kelurahan', villages, chunk =>
    prisma.addressVillage.createMany({
      data: chunk.map(r => ({ id: r.code, districtId: parentCode(r.code), name: r.name })),
      skipDuplicates: true,
    }))

  console.log('\n✅ Impor selesai.')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
