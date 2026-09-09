# Workflow Modes — Kapan Pakai Apa

> Ini soal CARA PAKAI Claude Code (mode, subagent, auto mode, hemat token),
> beda dari SOP proses per fase yang sudah ada di `CLAUDE.md` §  "Fase
> Eksekusi SOP" / "Milestone SOP". Baca ini sebelum mulai kerjaan besar.
>
> Diadopsi dari template `master-typescript` (2026-09-10) — bagian daftar
> plugin marketplace template DIHAPUS di sini karena belum diverifikasi
> plugin mana yang benar-benar terpasang di project ini.

## Decision Table — Pilih Mode

| Situasi                                                          | Mode/Cara                     |
|--------------------------------------------------------------------|----------------------------------|
| Task besar, berisiko, belum familiar dengan bagian codebase ini     | **Plan Mode** dulu               |
| Migration, refactor lintas modul, apa pun yang susah di-rollback   | **Plan Mode** dulu               |
| Task jelas scope-nya, kecil-menengah, ada git checkpoint            | **Auto Mode**                    |
| Kerjaan rutin/berulang yang polanya sudah terbukti aman            | **Auto Mode**                    |
| Eksplorasi/riset codebase besar, hasil cukup ringkasan saja          | **Subagent**                     |
| Audit banyak file sekaligus, independen satu sama lain              | **Subagent** (bisa paralel)      |
| Task kecil, tapi detail hasilnya kamu tetap perlu lihat langsung    | **Eksekusi langsung** (sesi utama) |
| High-stakes: auth, payment, migration data production               | **Eksekusi langsung** + Plan Mode |
| Debugging yang butuh iterasi cepat bolak-balik                      | **Eksekusi langsung**            |

## Kenapa Subagent BUKAN Selalu Lebih Hemat
Tiap subagent reload system prompt + tool definitions dari nol — subagent-heavy
workflow bisa sampai ~7x lebih mahal dibanding kerjain langsung di sesi utama,
KHUSUS untuk task kecil. Subagent baru worth it kalau:
- Task-nya butuh baca banyak file besar (>3-4 file) yang bakal bikin context
  sesi utama bengkak kalau dibaca langsung, DAN
- Kamu cuma butuh hasil ringkasannya, bukan raw detail tiap file

Kalau dua syarat itu nggak kepenuhi, kerjain langsung — lebih murah dan lebih cepat.

## Aturan Sebelum Mulai Kerjaan
1. Task ini "familiar & jelas" atau "besar & berisiko"? → tentukan Plan Mode vs Auto Mode.
2. Task ini butuh eksplorasi berat (banyak file) yang hasilnya cukup ringkasan?
   → pertimbangkan subagent. Kalau bukan → eksekusi langsung.
3. Kalau ragu antara subagent vs langsung untuk task medium → default ke
   **langsung dulu**. Baru pindah ke subagent kalau ternyata context sesi
   utama mulai berat/lambat.

## Hemat Token — Kebiasaan Harian
- **Jangan paste file/log besar ke chat** — kasih path-nya, biarkan Claude baca sendiri.
- **`/clear`** antar task yang topiknya nggak nyambung, jangan bawa histori lama terus.
- **`/compact`** kalau sesi udah panjang tapi masih task yang sama — jangan tunggu
  sampai otomatis trigger di saat kritis.
- **`CLAUDE.md` & skill jangan sering diedit-edit di tengah sesi** — itu bikin prompt
  cache invalid, kehilangan diskon token dari cache hit. Catatan khusus project
  ini: `CLAUDE.md` root sudah cukup besar (± 32 KB) karena memuat status per
  modul — hindari nambah section baru kalau sudah bisa masuk ke
  `docs/arsitektur-<modul>.md` yang ter-load on-demand saja.
- **Task paralel-independen** → subagent oke dijalankan bareng. Task yang saling
  bergantung urutannya → jangan dipaksa paralel, kerjain berurutan di sesi utama.

## Referensi
- Plan/Auto mode di-cycle pakai `Shift+Tab` di terminal, atau `/plan` untuk sekali pakai.
- Subagent didefinisikan di `.claude/agents/` (contoh: `security-auditor.md`).
- Detail proses per fase (bukan mode tool) → `CLAUDE.md` § "Fase Eksekusi SOP" & § "Milestone SOP".
