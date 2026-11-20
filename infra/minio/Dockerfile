# Image MinIO buatan sendiri — MinIO tidak lagi menerbitkan image/binary publik (quay.io: unauthorized,
# dl.min.io: 410) dan repo-nya diarsipkan. Versi di-pin di ARG MINIO_VERSION; menaikkannya = ubah di sini lalu
# jalankan workflow minio-image.yml (sekaligus perbarui tag di docker-compose.prod.yml).
# Dibangun oleh .github/workflows/minio-image.yml → ghcr.io/<repo>/minio:<versi>.
FROM golang:1.24-alpine@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
# Klien `mc` untuk penyiapan sekali jalan (setup.sh, SEC-305): bucket privat + user aplikasi berpolicy satu bucket.
ARG MC_VERSION=RELEASE.2025-08-13T08-35-41Z
# Revisi isi image di luar versi MinIO (tag = <MINIO_VERSION>-r<IMAGE_REV>): naikkan setiap isi image berubah supaya server menarik image baru,
# bukan memakai tag lama yang tersimpan. Harus sama dengan tag di docker-compose.prod.yml (dijaga scripts/test-minio-setup.ts).
ARG IMAGE_REV=3
RUN CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_VERSION}
RUN CGO_ENABLED=0 go install github.com/minio/mc@${MC_VERSION}

FROM alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f
RUN apk add --no-cache ca-certificates && adduser -D -u 1000 minio && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/bin/minio
COPY --from=build /go/bin/mc /usr/bin/mc
COPY --chmod=0755 setup.sh /usr/local/bin/minio-setup
# Non-root; volume baru mewarisi kepemilikan /data dari image.
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
