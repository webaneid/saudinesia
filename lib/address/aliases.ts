// Singkatan provinsi yang biasa diketik orang — nama resminya panjang ("Daerah Khusus Ibukota Jakarta"), jadi "DKI" tak ketemu tanpa ini.
// Hanya untuk pencarian (tak tampil). Kunci = kode wilayah Kemendagri (prisma/data/wilayah.sql), dijaga scripts/test-wilayah.ts.
export const PROVINCE_ALIASES: Readonly<Record<string, string>> = {
  '11': 'NAD', '12': 'Sumut', '13': 'Sumbar', '16': 'Sumsel', '19': 'Babel', '21': 'Kepri',
  '31': 'DKI', '32': 'Jabar', '33': 'Jateng', '34': 'DIY Jogja Jogjakarta', '35': 'Jatim',
  '52': 'NTB', '53': 'NTT', '61': 'Kalbar', '62': 'Kalteng', '63': 'Kalsel', '64': 'Kaltim', '65': 'Kaltara',
  '71': 'Sulut', '72': 'Sulteng', '73': 'Sulsel', '74': 'Sultra', '76': 'Sulbar', '82': 'Malut',
}
