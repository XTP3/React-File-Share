# Real-service browser validation

Run against an isolated MongoDB database and upload directory, never an existing user database. The suite creates fresh accounts and synthetic files and changes their passwords. It requires the production Go service with the built frontend on one origin; API requests are real and no application endpoints are mocked.

```sh
cd tests/browser
npm ci
BASE_URL=http://127.0.0.1:8080 CREATION_CODE=your-isolated-fixture-code npm test
```

Use a system Chromium or install the pinned Playwright browser. Override its path with `CHROMIUM_PATH`; the default is `/usr/bin/chromium` when available, otherwise the Playwright-installed Chromium. CI installs it with `node node_modules/playwright-core/cli.js install --with-deps chromium`. The pinned `playwright-core` package does not download another browser. Browser screenshots and the machine-readable report are written under ignored `artifacts/`, or `ARTIFACTS_DIR` when set.

The suite covers authentication, password change and logout, dark-first themes, preference restoration, search debounce and pagination, filters, collection membership, local upload previews and real transfers, public downloads, storage accounting, keyboard focus, narrow layouts, service-worker registration, and offline shell/cache policy. It fails on JavaScript exceptions and browser console errors, excluding expected unauthenticated and disconnected network requests. The isolated runner also copies the generated static build and appends a harmless comment to its own worker file to install a real replacement worker while a throttled upload is active, verifying that update reloads are deferred. This update check is reported as deferred when running against an external service.

For a running MongoDB service and built binary/frontend, the isolated runner owns startup and cleanup:

```sh
MONGO_URI=mongodb://127.0.0.1:27017 npm run test:isolated -- --binary /tmp/fileshare --www-dir ../../v2/Back-End/www
```

It uses a new random `rfs_browser_<32 hex>` database with an ownership marker, synthetic configuration in a temporary directory, and a free local HTTP port. It only drops the database carrying its marker and only removes its own temporary files.
