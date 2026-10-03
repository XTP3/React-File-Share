# V2 development

Use Go **1.27.1**, Node **24.19.0**, npm and MongoDB **7.0.16**. Production needs MongoDB and the compiled executable/static assets; it does not require Node.

From the repository root:

```sh
cd v2/Front-End
npm ci
npm test
npm run typecheck
npm run build
cd ../Back-End
go test ./...
go vet ./...
CGO_ENABLED=0 go build -trimpath -o fileshare ./cmd/fileshare
```

The frontend build writes `v2/Back-End/www`. Copy `Config.example.json` to an untracked `Config.json`, set your MongoDB URL and secrets, then run from `v2/Back-End`:

```sh
./fileshare --config ./Config.json --uploads-dir ./uploads --www-dir ./www --http-port 8080 --https-port 0
```

For frontend development, run `npm run dev` in `v2/Front-End`; Vite proxies API requests to the Go server at `127.0.0.1:8080`. Public runtime configuration comes from `/api/v2/config`; there is no frontend secret or server URL to bake into the build.

Run the isolated legacy compatibility suite against a local MongoDB instance from the repository root:

```sh
npm ci --prefix tests --ignore-scripts
python3 scripts/integration.py --binary ./v2/Back-End/fileshare
python3 scripts/test_package_release.py
```

`MONGO_URI` overrides the integration MongoDB address. The integration suite uses temporary fixture data; use a development database server.

Browser flows use a separately isolated fixture server and database. From `tests/browser`, install dependencies with `npm ci`, then install Chromium with `node node_modules/playwright-core/cli.js install --with-deps chromium`. Run:

```sh
npm run test:isolated -- --binary ../../v2/Back-End/fileshare --www-dir ../../v2/Back-End/www
```

`CHROMIUM_PATH` selects an existing Chromium executable; otherwise the runner uses an available system or Playwright-installed browser. Browser evidence is written to ignored `tests/browser/artifacts`.

Create a release bundle from an already built executable and frontend:

```sh
python3 scripts/package-release.py --version v2.0.0 --os linux --arch amd64 --binary v2/Back-End/fileshare
python3 scripts/package-release.py --checksums
```

Cross compilation uses `CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ...`; supported pairs are Linux amd64/arm64, Windows amd64 and Darwin amd64/arm64. The packaging script chooses `.zip` for Windows and `.tar.gz` elsewhere. Bundles contain only the executable, static `www`, example configuration, license and deployment instructions. Runtime paths and legacy compatibility are documented in [INSTALL](../docs/INSTALL.md), [UPGRADE](../docs/UPGRADE.md) and the [API contract](../docs/V2-API.md).
