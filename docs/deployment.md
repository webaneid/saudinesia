# Git, CI & Production — Saudinesia

> Status per 2026-10-21: **alur git + CI sudah berjalan; pipeline production BELUM dibangun.**
> Pola acuan: project `smartai` (`.github/workflows/`, `docs/conventions.md`, `docs/deployment-server-setup.md`,
> `docs/decisions/adr-0002-versioning-strategy.md`). Dokumen ini mencatat apa yang diambil, apa yang sengaja belum, dan
> keputusan yang masih menunggu pemilik project.

Repo: `https://github.com/webaneid/saudinesia` (private).

## 1. Alur git (sudah dipakai)

- `main` = jalur menuju production. **Tidak ada commit langsung** — hook `.claude/hooks/pre-commit-guard.sh` menolaknya
  (lapisan kenyamanan di sesi Claude Code; proteksi sungguhan = branch protection GitHub, lihat §3).
- Kerja lewat branch `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `docs/<slug>` → **pull request ke `main`** → CI harus hijau → merge.
- Commit = Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`). Ini bukan sekadar gaya: kalau nanti
  semantic-release dipasang (§4), pesan commit itulah yang menentukan nomor versi.
- Satu perubahan logis per commit. Skema Prisma berubah → **migrasinya ikut di commit/PR yang sama**.
- `prisma/migrations/` **harus di-commit** (sebelumnya ter-ignore sejak commit pertama — production memakai
  `prisma migrate deploy` dan tidak bisa berjalan tanpanya).

Perbedaan dengan smart-ai: smart-ai punya `develop` (staging, auto-deploy) di antara feature branch dan `main`. Saudinesia
belum punya staging, jadi PR langsung ke `main`. Menambah `develop` = keputusan §5 butir 3.

## 2. CI (`.github/workflows/ci.yml`)

Jalan di tiap pull request ke `main`. Langkah: `bun install --frozen-lockfile` → `prisma generate` → `typecheck` →
**migrasi diterapkan dari DB kosong dan harus sama dengan `schema.prisma`** (gagal kalau skema berubah tanpa migrasi) →
`build` → gitleaks. Postgres sungguhan lewat service container.

Diuji pada clone bersih sebelum di-commit (tanpa `.env.local`, hanya `DATABASE_URL` + `JWT_SECRET` dummy): semua langkah
selain gitleaks lolos. **gitleaks belum pernah dijalankan** (tidak terpasang lokal) — kalau menemukan false positive di
riwayat lama, tambahkan ke allowlist `.gitleaks.toml`, jangan matikan langkahnya.

Sengaja **tidak ada**: `lint` (project belum punya konfigurasi ESLint; `next lint` meminta input interaktif) dan test suite
(belum ada). Keduanya menyusul bila diadopsi.

## 3. Branch protection (WAJIB, dikerjakan pemilik repo di GitHub)

Settings → Branches → rule untuk `main`: require pull request, require status check **`validate`**, require branch up to
date, block force push, block deletion. Tanpa ini, hook dan CI hanya pengingat — siapa pun masih bisa `git push` langsung.

## 4. Production — perbandingan dengan smart-ai

| Komponen | smart-ai | Saudinesia hari ini |
|---|---|---|
| Versi & changelog otomatis | semantic-release (`release.yml`, `.releaserc.json`), `feat`→minor, `fix`→patch | belum ada; `package.json` versi `0.1.0` manual |
| Build image | GitHub Actions → GHCR (`ghcr.io/<repo>/web:<tag>`) | `Dockerfile` multi-stage sudah ada (bun standalone); belum ada workflow build/push |
| Compose production | `docker-compose.prod.yml` — memakai image GHCR, tidak membangun di server | `docker-compose.yml` **membangun di server** (`build:`), publish `3001:3000`, MinIO console `9001` terbuka — bentuk dev/awal |
| Reverse proxy + TLS | Caddy (`Caddyfile`, reload tiap deploy) | **Nginx + Let's Encrypt** tertulis di `docs/progress.md` M15 |
| Deploy | `deploy.yml`: scp compose → SSH → `docker compose pull && up -d` → health check; bisa **rollback** manual ke tag mana pun | belum ada |
| Env production | `.env.production` di server (`scripts/buat-env-production.sh`), tidak di repo | hanya `.env.example` |
| Staging | `develop` → `deploy-staging.yml` (belum diaktifkan di smart-ai sendiri) | belum ada |
| Migrasi saat deploy | role DB pemilik terpisah (`scripts/pisah-role-db.sh`), `migrate deploy` | belum ada; `migrate deploy` perlu jadi langkah deploy |
| Backup | `backup-produksi.sh` harian ke Drive, uji restore | `backup-db.sh`/`backup-minio.sh` ada, **belum dijadwalkan** di VPS |
| Secret scan | gitleaks di CI | gitleaks di CI (belum terbukti jalan) |
| Update dependency | Dependabot mingguan | belum ada |

Server VPS Hostinger **belum disiapkan** (`docs/progress.md` M15 semua belum dicentang), jadi tidak ada yang bisa
diverifikasi end-to-end. Itu sebabnya workflow deploy belum ditulis: konfigurasi production yang tak pernah dijalankan
lebih berbahaya daripada tidak ada.

## 5. Keputusan yang menunggu pemilik project

1. **Reverse proxy: Nginx (rencana M15) atau Caddy (seperti smart-ai)?** Caddy mengurus TLS otomatis dan lebih sedikit
   konfigurasi; Nginx sudah tertulis di rencana awal. Stack di `CLAUDE.md` hanya menyebut "single Docker container".
2. **Pasang semantic-release sekarang atau nanti?** Butuh disiplin Conventional Commits (sudah dijalankan) dan menambah
   devDependency + `release.yml`. smart-ai memakai override "breaking change = minor selama 0.x" (ADR-0002).
3. **Tambah branch `develop` + staging?** Menambah satu VPS/domain/`.env.staging`. smart-ai sendiri belum mengaktifkannya.
4. **Registry & akses:** GHCR dengan repo private (seperti smart-ai) — server login GHCR memakai token job deploy.
5. **Rahasia GitHub Actions** yang dibutuhkan saat deploy dibangun: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`
   (pola smart-ai). **Jangan** ditempel di chat; isi langsung di GitHub → Settings → Secrets.

Urutan kerja yang disarankan setelah keputusan di atas: (a) `docker-compose.prod.yml` + proxy + `.env.production.example`,
(b) provisioning VPS (M15), (c) `deploy.yml` dengan health check + rollback, (d) baru semantic-release.
