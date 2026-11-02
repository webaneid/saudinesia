import { prisma } from '@/lib/db'
import { decryptPii, encryptPii, piiIndex, PiiDecryptError, timingSafeEqualHex } from './cipher'
import { requirePiiKeys, type PiiKeys } from './keys'

// Cek kunci PII terhadap database (SEC-168, docs/arsitektur-jamaah.md §6). Format kunci yang sah belum berarti kunci yang BENAR: env yang dibuat
// ulang atau tertukar antar-lingkungan membuat HMAC NIK berbeda → keunikan identitas pecah diam-diam (NIK sama = dua orang) dan ciphertext lama
// tak terbaca. Pemakaian pertama menulis nilai cek (tabel pii_key_checks, bukan rahasia); berikutnya dibandingkan. Tidak cocok → setiap penulis
// PII menolak bekerja (gagal-tertutup) sampai kunci yang benar dipasang.
//   'index'    = HMAC(kunci indeks, tujuan key-check)
//   'enc:<v>'  = kanari AES-GCM per versi kunci enkripsi — versi pensiun yang punya baris juga dicek (kunci rotasi yang salah ketik ketahuan)

const CANARY = 'saudinesia'

export class PiiKeyMismatchError extends Error {
  constructor(which: string) { super(`Kunci PII tidak cocok dengan database (${which}). Pasang kunci yang benar; jangan membuat kunci baru untuk data yang sudah ada.`); this.name = 'PiiKeyMismatchError' }
}

const verified = new WeakSet<PiiKeys>() // per objek kunci tervalidasi (requirePiiKeys meng-cache per isi env)

type Db = Pick<typeof prisma, 'piiKeyCheck'>

export async function ensurePiiKeysMatch(db: Db = prisma): Promise<void> {
  const keys = requirePiiKeys()
  if (verified.has(keys)) return
  const encId = `enc:${keys.encryption.version}`
  // Tulis bila belum ada (skipDuplicates = ON CONFLICT DO NOTHING: dua proses serentak tak saling menimpa), lalu SELALU bandingkan dengan yang tersimpan.
  await db.piiKeyCheck.createMany({
    data: [{ id: 'index', value: piiIndex('key-check', CANARY) }, { id: encId, value: encryptPii('key-check', CANARY) }],
    skipDuplicates: true,
  })
  const rows = await db.piiKeyCheck.findMany({ select: { id: true, value: true } })
  const index = rows.find(r => r.id === 'index')
  if (!index || !timingSafeEqualHex(index.value, piiIndex('key-check', CANARY))) throw new PiiKeyMismatchError('PII_INDEX_KEY')
  for (const r of rows) {
    const m = /^enc:([1-9]\d{0,5})$/.exec(r.id)
    if (!m) continue
    const v = Number(m[1])
    if (v !== keys.encryption.version && !keys.retired.has(v)) continue // versi yang sudah tak dipasang sama sekali: tak bisa dicek (data versi itu memang tak terbaca)
    let opened: string
    try { opened = decryptPii('key-check', r.value) } catch (e) {
      if (e instanceof PiiDecryptError) throw new PiiKeyMismatchError(`kunci enkripsi versi ${v}`)
      throw e
    }
    if (opened !== CANARY) throw new PiiKeyMismatchError(`kunci enkripsi versi ${v}`)
  }
  verified.add(keys)
}
