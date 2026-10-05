# Real-service browser validation

Run against an isolated MongoDB database and upload directory, never an existing user database. The suite creates fresh accounts and synthetic files and changes their passwords. It requires the production Go service with the built frontend on one origin; API requests are real and no application endpoints are mocked.

```sh
cd tests/browser
npm ci
BASE_URL=http://127.0.0.1:8080 CREATION_CODE=your-isolated-fixture-code npm test
```

Use a system Chromium or install the pinned Playwright browser. Override its path with `CHROMIUM_PATH`; the default is `/usr/bin/chromium` when available, otherwise the Playwright-installed Chromium. CI installs it with `node node_modules/playwright-core/cli.js install --with-deps chromium`. The pinned `playwright-core` package does not download another browser. Browser screenshots and the machine-readable report are written under ignored `artifacts/`, or `ARTIFACTS_DIR` when set.

The isolated suite runs 14 groups covering authentication, password change and logout, dark-first themes, preference restoration, search debounce and pagination, filters, collection membership, local upload previews and real transfers, public downloads, storage accounting, keyboard focus, narrow layouts, service-worker registration, and offline shell/cache policy. It fails on JavaScript exceptions and browser console errors, excluding expected unauthenticated and disconnected network requests. The isolated runner also copies the generated static build and appends a harmless comment to its own worker file to install a real replacement worker while a throttled upload is active, verifying that update reloads are deferred. This update check is reported as deferred when running against an external service.

Layout checks cover the centered X auth card, Login/Create Account labels, sidebar collection controls, current-page header, full-width mobile Upload button, full-height filter sheet, and persisted Uncollected filter independent of collection preferences. Desktop and mobile lists must mount exactly one layout. Image list thumbnails must use the authenticated `/api/v2/files/{id}/thumbnail` endpoint, preserve aspect ratio within 384 pixels, transfer fewer bytes than the original fixture, and avoid fetching original image bytes until preview opens.

Real PNG, VP8 WebM, and PCM WAV previews are exercised at desktop, portrait mobile (390 × 844), and landscape mobile (844 × 390) sizes. Checks verify playback/pause, keyboard and pointer seeking followed by continuing timeline updates, mute, volume, playback speed, maximize/restore, fullscreen, control visibility, and direct original-file links opening decoded browser image/media viewers. Mobile preview fills the portrait viewport. Temporary media uploads are removed before storage count checks. Checked-in [synthetic fixtures](fixtures/README.md) and a Node-generated WAV keep FFmpeg out of the runtime requirements.

Screenshots include desktop/mobile auth, image/audio/video previews, landscape previews, mobile filters and uploads, and the offline shell. `report.json` records each group's result, unrun/deferred checks, thumbnail dimensions/bytes, and native fullscreen outcomes.

For a running MongoDB service and built binary/frontend, the isolated runner owns startup and cleanup:

```sh
MONGO_URI=mongodb://127.0.0.1:27017 npm run test:isolated -- --binary /tmp/fileshare --www-dir ../../v2/Back-End/www
```

It uses a new random `rfs_browser_<32 hex>` database with an ownership marker, synthetic configuration in a temporary directory, and a free local HTTP port. It only drops the database carrying its marker and only removes its own temporary files.

Cross-page selection checks exercise the tri-state page checkbox in desktop list, grid, and mobile views, search/sort persistence, explicit clearing, cancelled removal, and preserving unrelated selection after a row action. Browser Back must close an open removal confirmation without changing membership; Forward must leave it closed. A temporary collection exercises the searchable, sorted, category-filtered library picker across both pages, cancellation, idempotent membership addition, and bulk removal of off-page selections. It removes its collection and leaves the original 33-file fixture intact. Mobile auth, search, filters, collection dialogs, and picker inputs must compute to at least 16px; a wide coarse-pointer context checks the same rule. Viewport assertions preserve pinch zoom. Chromium cannot reproduce Safari focus zoom itself.
