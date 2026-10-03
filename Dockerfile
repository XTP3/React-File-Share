# syntax=docker/dockerfile:1
# Build with: docker build -t fileshare:v2 .
FROM node:24.19.0-alpine AS frontend
WORKDIR /src/v2/Front-End
COPY v2/Front-End/package*.json ./
RUN --mount=type=secret,id=build-ca \
    if [ -f /run/secrets/build-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build-ca; fi; npm ci
COPY v2/Front-End/ ./
RUN npm run build

FROM golang:1.27.1-alpine AS backend
ARG VERSION=2.0.0
WORKDIR /src/v2/Back-End
COPY v2/Back-End/go.mod v2/Back-End/go.sum ./
RUN --mount=type=cache,id=fileshare-gomod,target=/go/pkg/mod \
    --mount=type=secret,id=build-ca \
    if [ -f /run/secrets/build-ca ]; then export SSL_CERT_FILE=/run/secrets/build-ca; fi; go mod download
COPY v2/Back-End/ ./
RUN --mount=type=cache,id=fileshare-gomod,target=/go/pkg/mod \
    --mount=type=cache,id=fileshare-gobuild,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOMAXPROCS=2 go build -p 2 -trimpath -ldflags="-s -w -X main.version=${VERSION}" -o /fileshare ./cmd/fileshare

# Populate durable/runtime directories without a runtime package manager.
RUN mkdir -p /runtime/app/www /runtime/config /runtime/data/uploads /runtime/tmp \
    && chown -R 10001:10001 /runtime/app /runtime/data /runtime/tmp && chmod 1777 /runtime/tmp

FROM scratch
COPY --from=backend /runtime/ /
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=backend /usr/local/go/lib/time/zoneinfo.zip /usr/share/zoneinfo.zip
ENV ZONEINFO=/usr/share/zoneinfo.zip
WORKDIR /app
COPY --from=backend /fileshare /app/fileshare
COPY --from=frontend --chown=10001:10001 /src/v2/Back-End/www/ /app/www/
COPY v2/Back-End/Config.example.json /app/Config.example.json
COPY LICENSE /app/LICENSE
USER 10001:10001
EXPOSE 8080
VOLUME ["/data/uploads"]
ENTRYPOINT ["/app/fileshare"]
CMD ["--config", "/config/Config.json", "--uploads-dir", "/data/uploads", "--www-dir", "/app/www", "--http-port", "8080", "--https-port", "0"]
