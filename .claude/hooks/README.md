# Hooks — Enforcement Deterministik

CLAUDE.md itu *advisory* (Claude ikuti ~sebagian besar waktu, bukan 100%). Untuk
aturan yang WAJIB tanpa pengecualian, pakai hooks — hooks jalan otomatis lewat
event, komunikasi hasil via exit code, jadi selalu konsisten.

> Diadopsi dari template `master-typescript` (2026-09-10), disesuaikan ke
> struktur project ini (Next.js App Router + Prisma, satu app — bukan monorepo
> `apps/api`/`apps/web`).

## Hook: Lint Otomatis Setelah Edit (post-edit-lint.sh)
Jalan tiap Edit/Write ke file `.ts`/`.tsx` — auto-fix lint issue (`eslint --fix`)
SEGERA, bukan numpuk sampai ketauan pas CI. **Warning** (exit 1), bukan hard
block — skip diam-diam kalau belum ada config eslint (project ini **belum**
punya `eslint.config.*`/`.eslintrc*` sama sekali per audit retrofit 2026-09-10,
jadi hook ini idle sampai eslint di-setup). Skip juga kalau `bunx` tidak
tersedia di environment ini.

## Hook: Cegah Commit Langsung ke `main` (pre-commit-guard.sh)
Jalan di `PreToolUse` untuk Bash — cuma cek command yang benar-benar
`git commit` (bukan block semua Bash call di branch main). **Hard block**
(exit 2) kalau branch saat ini `main` — sesuai `CLAUDE.md` § Git: kerja lewat
feature branch (`feat/...`, `fix/...`, `chore/...`).

## Hook: ADR Immutability Guard (adr-guard.sh)
Jalan di `PreToolUse` untuk Edit/Write — **hard block** (exit 2) kalau ada
yang coba edit file `docs/decisions/adr-*.md` yang statusnya sudah
`Accepted`. Ini aturan biner, sesuai `docs/decisions/adr-template.md`: "ADR
TIDAK diedit setelah Accepted, buat ADR baru + tandai Supersedes kalau
keputusan berubah". ADR baru (file belum ada) dan `adr-template.md` sendiri
tidak kena block.

**Catatan penting untuk project ini**: `docs/decisions/adr-*.md` adalah
mekanisme BARU (2026-09-10) untuk keputusan arsitektur BESAR ke depan —
belum ada migrasi retroaktif dari `docs/decisions.md` (log historis 319 KB,
format bebas, terus dipakai untuk keputusan implementasi sehari-hari, TIDAK
di-freeze). Jadi: keputusan besar/struktural → ADR baru di
`docs/decisions/adr-XXXX-....md` (immutable setelah Accepted); keputusan
implementasi rutin → tetap append ke `docs/decisions.md` seperti biasa.

## Lapis Kedua (Independen dari Claude Code) — WAJIB Kalau Serius
Hook di atas cuma jalan kalau **Claude** yang nulis file lewat Claude Code.
Kalau diedit manual terus `git commit` sendiri, hook itu nggak ke-trigger
sama sekali. Buat proteksi yang independen dari siapa pun yang commit:

```bash
# Install gitleaks, lalu pasang sebagai git pre-commit hook asli (bukan Claude Code)
brew install gitleaks   # atau: https://github.com/gitleaks/gitleaks#installing
echo '#!/bin/sh
gitleaks protect --staged --verbose' > .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```
Ini jalan di level git, bukan Claude Code — jadi tetap protect meskipun
commit-nya dari kamu langsung atau editor lain. Project ini belum punya CI
(`.github/workflows/`) — kalau nanti ditambah, masukkan gitleaks/trufflehog
sebagai step di situ juga.

## Hook: Secret Scanning (secret-scan.sh)
Otomatis mengecek pola secret (AWS key, private key, password/secret
hardcoded) di tiap file yang diedit, dan **block** (exit code 2) kalau
ketemu. Ini lapisan pertama; untuk production sebaiknya ditambah
gitleaks/trufflehog seperti di atas sebagai lapisan kedua yang scan seluruh
history git, bukan cuma file yang baru diedit.

## Hook: Dependency Audit (dependency-audit.sh)
Jalan otomatis tiap `bun add <package>` — cek known vulnerability lewat
`bun audit`. Beda dari secret-scan: ini **warning** (exit 1), bukan hard block
(exit 2), karena hasil audit bisa noisy/false-positive dan butuh judgment
manusia untuk keputusan lanjut/tidak.

## Hook: Security Review Reminder (security-review-reminder.sh)
Jalan otomatis tiap Edit/Write ke file `.ts`/`.tsx` yang polanya
security-sensitive (`route.ts`, `*auth*`, `*upload*`, `*webhook*`,
`*payment*`, `middleware.ts`) — **warning** (exit 1), bukan hard block,
mengingatkan supaya skill `security-review` tidak kelupaan dipanggil sebelum
task dianggap selesai.

## Skill: security-review
`.claude/skills/security-review/SKILL.md` — dipanggil setelah selesai bikin
endpoint/fitur baru, cek kode yang baru ditulis terhadap checklist di
`docs/architecture/architecture-security.md`, per file, cepat.

## Subagent: security-auditor
`.claude/agents/security-auditor.md` — untuk audit menyeluruh (banyak file/
seluruh folder), read-only, jalan di context terisolasi supaya tidak
menghabiskan context sesi utama. Cocok dipanggil sebelum release atau
audit berkala, bukan tiap kali edit kecil.

## Registrasi di settings.json
Hooks didaftarkan di `.claude/settings.json`, di-map ke event tertentu
(`PreToolUse`/`PostToolUse` — cek dokumentasi resmi Claude Code untuk nama
event terbaru kalau ada perubahan versi).

> Jangan taruh logic bisnis di hooks — hooks untuk *enforcement*, bukan business logic.

## Perluasan 2026-10-21 — `security-review-reminder.sh`

Selain Route Handler/auth/upload/webhook/payment/middleware, hook ini kini juga mengingatkan (exit 1 = peringatan, bukan
blok) untuk: `lib/auth/*`/OTP/session, `lib/storage/*`, serta file **infra/pipeline** — `Dockerfile*`,
`docker-compose*.yml`, `Caddyfile*`, `.github/workflows/*.yml`, `.github/dependabot.yml`, `scripts/*.sh|*.ts`,
`.env*.example`, `.dockerignore`, `next.config.ts`, `instrumentation*.ts`. Pengingat ini lapisan kenyamanan; kewajiban
sebenarnya ada di `CLAUDE.md` § Fase Eksekusi SOP langkah 5 (Security check) dan CI (`bun audit --audit-level=critical`,
gitleaks).
