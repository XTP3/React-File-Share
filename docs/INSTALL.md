# Install v2

Choose the release matching your OS and CPU: Linux `amd64`/`arm64`, Windows `amd64`, or macOS (`darwin`) `amd64`/`arm64`. Download the bundle and `SHA256SUMS` from the same GitHub release. Verify the downloaded archive before extracting:

```sh
sha256sum --ignore-missing -c SHA256SUMS
# macOS: shasum -a 256 <archive.tar.gz> and compare with SHA256SUMS
# PowerShell: Get-FileHash <archive.zip> -Algorithm SHA256
```

Extract into a new application directory. Each bundle contains `fileshare` (`fileshare.exe` on Windows), `www`, `Config.example.json`, `LICENSE`, `INSTALL.md` and `UPGRADE.md`.

MongoDB is an external service. Use MongoDB 7.0.16 or a compatible supported version. For a new installation, copy `Config.example.json` to a private `Config.json` and set `DATABASE_URL`, `ACCOUNT_CREATION_CODE` and `JWT_SECRET_KEY`. Choose unique random secrets. Protect this file with permissions appropriate to your service account. For an existing installation, follow UPGRADE.md and reuse its configuration, database and uploads.

Keep application files separate from durable data. Start on an unprivileged port, supplying explicit absolute paths:

```sh
/opt/fileshare/fileshare \
  --config /etc/fileshare/Config.json \
  --uploads-dir /srv/fileshare/uploads \
  --www-dir /opt/fileshare/www \
  --http-port 8080 --https-port 0
```

On Windows use `fileshare.exe` with the same flags and your absolute Windows paths. The service account needs read access to configuration/static files and read/write access to the entire uploads directory, including staging/recovery data. Keep that directory on one filesystem. If the old uploads root is a symbolic link, pass its resolved real directory path. Relative runtime paths resolve against the selected configuration location; absolute paths avoid ambiguity when a service changes working directory.

Uploads flush file content and record MongoDB recovery intents before publication. Unix builds also sync directory metadata where supported. Windows does not expose equivalent directory fsync through Go: interrupted-process recovery is supported, but Windows has weaker directory-metadata durability on sudden power loss. Keep coordinated backups; use storage and MongoDB durability settings appropriate to your deployment.

The legacy configuration keys are accepted, including HTTP/HTTPS ports, TLS paths/passphrase, bcrypt/JWT settings, upload limits and date settings. Set TLS certificate/key paths if serving HTTPS directly. An HTTPS listener cannot start without usable certificate material. With a reverse proxy, terminate HTTPS there and forward to an internal HTTP port; configure the proxy to preserve the host and scheme, allow your upload request size and avoid short transfer timeouts. When HTTPS terminates at the proxy, set `"SECURE_COOKIES": true` in `Config.json` so session cookies are marked Secure even though the backend connection is HTTP. Set `"ALLOWED_ORIGINS": ["https://files.example.com"]` to the exact public origin if the proxy changes the backend Host header. Origins contain scheme and host (plus a nondefault port when applicable), without paths or wildcards. Preserve incoming Origin headers; do not broadly allow unrelated sites. Direct HTTPS automatically uses Secure cookies; local HTTP development can leave SECURE_COOKIES false. Browser sessions and PWA installation should use HTTPS, or localhost for development. The frontend is served from the same origin and reads its public configuration at runtime.

Example Linux systemd unit (adjust paths and existing service user):

```ini
[Unit]
Description=File Share v2
Wants=network-online.target
After=network-online.target

[Service]
User=fileshare
Group=fileshare
WorkingDirectory=/opt/fileshare
ExecStart=/opt/fileshare/fileshare --config /etc/fileshare/Config.json --uploads-dir /srv/fileshare/uploads --www-dir /opt/fileshare/www --http-port 8080 --https-port 0
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/srv/fileshare/uploads

[Install]
WantedBy=multi-user.target
```

Create the user/directories and set ownership before enabling the unit. Back up both MongoDB and uploads as a coordinated snapshot with writes stopped. Check login, a small upload, preview, download and deletion after deployment; `/api/v2/config` also confirms the public runtime settings.

## Docker

Build from the repository root with `docker build -t fileshare:v2 .`. Set `--build-arg VERSION=v2.0.0` to stamp a particular build version. The image builds static assets and the Go executable in separate stages and runs as UID/GID 10001. Its scratch runtime includes trusted CA certificates and timezone data copied from the official Go build image; it has no shell or package manager. MongoDB runs externally. Set `DATABASE_URL` to an address reachable from the container, rather than its own localhost. Prepare a private configuration file that UID 10001 can read, and grant UID 10001 read/write access to the uploads directory. For example, a configuration owned by UID 10001 can retain mode 0600; a root-owned mode-0600 file is unreadable to this container user. Keep the configuration mount read-only:

```sh
docker run --name fileshare -p 8080:8080 \
  --mount type=bind,src=/etc/fileshare/Config.json,dst=/config/Config.json,readonly \
  --mount type=bind,src=/srv/fileshare/uploads,dst=/data/uploads \
  fileshare:v2
```

Builds behind a TLS inspection proxy can pass their trusted CA bundle with `--secret id=build-ca,src=/path/to/trusted-ca-bundle.pem` and standard HTTP_PROXY/HTTPS_PROXY build arguments. The build secret is used only for dependency downloads and is not added to runtime trust or the final image. TLS verification remains enabled.

The uploads mount is durable and must include any staging/recovery files. Mount certificates read-only if using direct TLS and override the default command flags as required. Retain the external database and uploaded data when replacing the container. Runtime configuration and uploads are excluded from the image context.

## Build from source

See `v2/README.md` in the source repository. Build the frontend first with `npm ci && npm run build`, then build `./cmd/fileshare` from `v2/Back-End` with `CGO_ENABLED=0`. Distribute `www` alongside the executable; assets are not embedded.
