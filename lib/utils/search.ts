// Murni (tanpa Prisma/next/*). Prisma `contains` TIDAK meloloskan wildcard LIKE: "%" atau "_" di kotak cari cocok dengan baris apa pun (SEC-103). Pencarian teks bebas dari
// pengguna WAJIB lewat sini. Garis miring terbalik adalah karakter escape bawaan PostgreSQL untuk LIKE/ILIKE, yang dipakai Prisma untuk `contains`/`startsWith`/`endsWith`.
export const escapeLike = (v: string): string => v.replace(/[\\%_]/g, '\\$&')
