# Image MinIO buatan sendiri — MinIO tidak lagi menerbitkan image/binary publik (quay.io: unauthorized,
# dl.min.io: 410) dan repo-nya diarsipkan. Versi di-pin di ARG MINIO_VERSION; menaikkannya = ubah di sini lalu
# jalankan workflow minio-image.yml (sekaligus perbarui tag di docker-compose.prod.yml).
# Dibangun oleh .github/workflows/minio-image.yml → ghcr.io/<repo>/minio:<versi>.
FROM golang:1.24-alpine AS build
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
RUN CGO_ENABLED=0 go install github.com/minio/minio@${MINIO_VERSION}

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && adduser -D -u 1000 minio && mkdir /data && chown minio:minio /data
COPY --from=build /go/bin/minio /usr/bin/minio
# Non-root; volume baru mewarisi kepemilikan /data dari image.
USER minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
