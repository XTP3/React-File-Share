# React File Share v2 frontend

React 19 + TypeScript + Vite, TanStack Query, and the actual shadcn Vega preset `b67f2pbcWY`. See [SHADCN-PRESET.md](SHADCN-PRESET.md) for generation provenance and token choices.

Use Node 24.19.0 / npm 11:

```sh
npm ci
npm run dev
npm test
npm run typecheck
npm run build
```

Development proxies `/api` and public `/f/` share links to the Go service at `127.0.0.1:8080`. Production build emits `../Back-End/www`, which Go serves on the same origin. No Node server is needed in production. The integration contract is [V2-API.md](../../docs/V2-API.md).

`npm test` runs meaningful non-watch Vitest checks for authentication API responses, CSRF/cancellation/private-cache policy, search debounce and stale request aborts, preference validation/isolation, timezone-aware dates, exact filter construction, thumbnail cleanup/bounds, and transfer concurrency/cancellation/collection isolation. Real-service Chromium coverage is in the repository's `tests/browser` workflow.

The service worker caches only the public application shell, icons, scripts/styles and bundled fonts. It never runtime-caches account APIs, uploaded files or public download/view URLs. First use defaults to dark; theme is applied before first paint. Explorer preferences are versioned and scoped by account and stable collection IDs. No authentication tokens or file contents are persisted in preferences.

Uploads use up to three concurrent single-file multipart requests, with individual progress, cancellation and retry. Queue selection is local; object URLs are limited to 30 images of at most 12 MB and are released on remove/clear/unmount. Upload destination is captured on submission. An available PWA update cannot reload while transfers are active; keep the application open during transfers.
