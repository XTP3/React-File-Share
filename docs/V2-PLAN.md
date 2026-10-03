# React File Share v2 plan

This document records the approved architecture and requirements. Implementation is in progress; validation results are recorded separately as checks complete.

## Architecture and compatibility

Use a Go backend with the official MongoDB driver, serving a static React/TypeScript frontend built with Vite, shadcn/ui, and TanStack Query. Retain Back-End and Front-End within each version's directory. Production runs the Go executable alongside the existing MongoDB database; Node is required for frontend development and builds.

The replacement must operate directly on the existing users and files collections and uploads/<user uniqueID>/<filename> layout. Preserve IDs, MongoDB ObjectIDs, field names and types, optional and unknown fields, numeric timestamps, existing bcrypt hashes, and legacy share URLs. Support existing Back-End/Config.json keys, including HTTP/HTTPS ports, TLS certificate paths and passphrase, account creation code, JWT settings, upload limits, and date settings. Preserve legacy successful API response formats and bearer authentication. A v2 cookie session flow can improve browser authentication while preserving legacy clients and unexpired tokens.

Retain account creation, login, logout, password changes, multiple uploads, progress, sorting, searching, refreshing, viewing, downloading, copying both kinds of share links, and file deletion. Preserve navigation paths and provide correct SPA deep linking. Runtime public configuration replaces a hardcoded frontend server address and synchronizes upload limits.

No mandatory database conversion, password reset, or file relocation. Auxiliary collection records, membership records, and recovery records are additive. A coordinated backup and an upgrade/rollback procedure are part of the release.

Next.js remains technically viable with Node Route Handlers and a streaming multipart parser. It was evaluated against current documentation and Node's formData implementation. Go is selected for direct control of streaming, storage, cancellation, and deployment without a frontend server runtime.

## Repository organization

Archive the current application's source, original README, and preview image under v1/. Build the replacement application under v2/, with its Back-End and Front-End subdirectories. Keep .git, LICENSE, a repository-level README, shared project instructions, repository-wide CI configuration, and docs/V2-PLAN.md at the repository root.

```text
.
├── v1/
│   ├── Back-End/
│   ├── Front-End/
│   ├── README.md
│   └── preview.png
├── v2/
│   ├── Back-End/
│   └── Front-End/
├── docs/
│   └── V2-PLAN.md
├── README.md
└── LICENSE
```

Treat v1 as a reference implementation, with its application behavior preserved. V2 is independently buildable and runnable; it does not import v1 application code or depend on the archived source at runtime. Compatibility fixtures and tests may use v1 to verify behavior.

The repository layout is separate from installation and data layout. A v2 release must accept the existing configuration and uploads directory at their actual paths and reuse the existing database. Configurable data paths prevent a code relocation from becoming a required file migration. Preserve local configuration, uploads, generated files, and existing changes during relocation. Exclude dependencies, generated build outputs, uploaded data, and local secrets from new commits. Update development helpers, setup instructions, and CI paths after relocation and verify both version workflows.

## Preset, themes, and UI requirements

Use shadcn preset b67f2pbcWY. Its decoded settings were verified with the published shadcn 4.21.1 preset implementation:

- Style: vega.
- Base color: neutral.
- Theme: blue, overridden with the user's exact accent #2983ff.
- Body font: Montserrat.
- Heading font: Manrope.
- Icon library: Lucide.
- Radius: default.
- Menu accent: subtle.
- Menu color: default-translucent.
- Chart color: neutral.

Initialize with the specified --preset code and preserve its typography, spacing, radii, and component styling. The code does not itself select a component primitive library; resolve that choice through the supported CLI configuration at initialization.

Dark is the first-use default. Provide an accessible shadcn theme control for dark, light, and optionally system mode. Apply saved theme before first paint. Centralize all product styling in semantic CSS variables: primary, primary foreground, backgrounds, surfaces, text, borders, focus rings, sidebar accents, typography, radii, and layout spacing. Derive interaction states from tokens. Reusable application layouts and feature components compose shadcn components.

Use shadcn for application buttons, inputs, forms, menus, popovers, drawers/sheets, dialogs, validation messages, progress, loading/empty/error states, and toast feedback. Never use alert(), confirm(), prompt(), browser-native media controls, or default browser error pages as application feedback. Media previews are rendered inside shadcn Card/AspectRatio compositions. Native platform file selection is opened through the shadcn file input/control.

The user approved a contrasting dark foreground on #2983ff buttons. White text has approximately 3.63:1 contrast; #0a0a0a has approximately 5.45:1. The implementation must meet applicable accessibility contrast requirements and verify both themes. Preserve keyboard navigation, labels, focus management, reduced-motion preferences, and comfortable touch targets.

## File explorer, search, filters, and sorting

Build a desktop table and mobile card/list presentation with preserved preview, download, view/share links, and delete actions. Use shadcn menus or mobile drawers to keep actions accessible on narrow screens. Show consistent loading, empty, error, and retry states.

Support:

- Filename search, preserving the existing useful case-insensitive matching behavior.
- Filename ascending/descending, upload time newest/oldest, size ascending/descending, and type sorting.
- Multiple file-type/category filters, size ranges, upload-date ranges, and collection/uncollected filtering in the main explorer.
- Composable search, filters, and sorting, with visible active-filter indicators and a clear/reset action.
- Server-side pagination with a default page size of 25 and a bounded configurable maximum.
- Stable ordering with a deterministic secondary ID sort.
- The same explorer behavior within an individual collection.

Debounce search approximately 300 ms; submit immediately on Enter or explicit search. Cancel superseded requests and prevent stale results from replacing newer results. Use query caching and deduplication. Reset pagination when search, filters, or sorting change. Retain useful results during refresh with an accurate loading state. Combine selected type filters with OR and distinct filter dimensions with AND.

Provide a versioned listing API, for example GET /api/v2/files with page, pageSize, q, sort, direction, category, size/date range, and optional collectionId parameters. Return items, matched total, and pagination metadata. Preserve the legacy /f response shape and legacy search behavior through compatibility handlers. The new filename search treats ordinary input safely; legacy pattern behavior requires validation and query execution bounds.

Use suitable owner/sort indexes. Unanchored substring matching may still scan a user's files; measure performance and avoid promising that ordinary indexes eliminate that cost. Do not introduce a separate search service without evidence it is necessary.

## Selection preview and upload workflow

Before any transfer, display a local preview of every selected file. Show thumbnail/poster where practical, filename, category/type, and human-readable size. Unsupported content uses a file icon and metadata. Use shadcn components for the queue, totals, remove buttons, clear action, validation, and final upload action.

Allow removal of individual files, adding more files, and clearing the entire selection before uploading. Recompute count and total size on every change. Identify conflicting filenames and show understandable feedback before submission. Selection and preview do not upload files or create backend records.

Keep object URLs and thumbnail work bounded and release resources when files are removed, the queue is cleared, or the component unmounts. Do not load large documents or videos entirely into JavaScript memory for previews.

After submission, provide bounded concurrent transfers, progress, cancellation, retry, and precise per-file outcomes. Preserve the legacy endpoint's multi-file multipart behavior and aggregate request limit. Server enforcement remains authoritative. Downloads use browser-managed streaming rather than an entire-file JavaScript blob.

On the backend, stream into a staging area on the destination filesystem. Enforce cumulative limits while reading. Check every filename and refuse overwrite during finalization, including simultaneous conflicting requests. Clean up rejected and interrupted uploads. Journal recoverable storage/database operations; MongoDB and the filesystem cannot commit atomically together. Work with standalone MongoDB without requiring transactions or a replica set.

## Storage statistics

Show a shadcn usage summary with human-readable stored bytes, total file count, and counts/size by file category. Categories include photos, GIFs, videos, audio, PDFs/documents, ZIPs/other archives, and other files. Assign each file one primary category so totals are meaningful; use MIME information with an extension fallback for legacy data.

Storage accounting must be checked against the files on disk, rather than trusting potentially stale legacy fileSize values. Use an initial reconciliation, successful mutation updates, periodic reconciliation, and a refresh/readiness status. Cache the resulting statistics; do not walk every file on every page request. Handle missing files, orphaned files, and duplicate legacy references without deleting or renaming existing data automatically.

Describe usage as file-content bytes, distinguishing it from filesystem allocation overhead if that is ever displayed. Preserve a consistent human-readable unit convention. MAX_UPLOAD_SIZE remains an upload-request limit, not an assumed account storage quota.

Global usage counts each stored file once. A collection's totals count its distinct member files, even when they also belong to other collections. Global usage stays global when explorer filters change; matched-result counts are shown separately.

## Collections

The user approved multiple collection membership: files may belong to multiple collections and are physically stored once. Removing membership or deleting a collection preserves the underlying files; global storage statistics count each file once. Collections are owner-private organizational views. Existing public file links retain their behavior.

Create an additive collections collection with stable ID, owner ID, required nonempty title, and creation/update timestamps. Store membership in an additive collection_memberships collection with indexed owner/collection/file references and unique membership pairs. This avoids unbounded arrays in collection documents and leaves legacy file records untouched.

Provide create, rename, delete, add/remove files, and collection browsing flows through shadcn UI. A title is required and validated on both client and server. Verify ownership for every collection and file operation. The user approved bulk assignment: support selecting several files and assigning them to a collection.

Removing a file from a collection removes only its membership. Deleting a collection removes its memberships and leaves files intact. Deleting a file from storage removes its collection memberships through the recovery-aware deletion workflow. The main explorer continues to include all owned files, including uncollected files.

Each collection has its own search, sorting, filters, pagination, and statistics. Persist view preferences by stable collection ID so renaming does not reset them.

## Preference persistence and PWA behavior

Persist theme, explorer presentation, sorting, filters, and page size in browser storage. Keep main-explorer preferences separate from each collection's preferences, and scope authenticated preferences by user ID. Version and validate stored settings; gracefully handle invalid or unavailable storage. Never persist credentials or file contents as preferences. Restoring preferences must not overwrite newer user interaction while requests are loading.

Provide a complete installable PWA manifest, icons, an offline application shell, connection feedback, and update handling. Use explicit caching policies for account-specific data and downloads. File transfers require connectivity; mobile platforms may suspend background activity. Show service-worker update feedback through shadcn. The user approved deferring PWA update reloads while uploads are active.

## Implementation order and acceptance tests

GitHub Actions runs backend and frontend checks, compatibility/integration tests, and compiles both the Go binary and static frontend. Produce release bundles for Linux amd64/arm64, Windows amd64, and macOS amd64/arm64, with pinned toolchains and locked dependencies. Each bundle contains the executable, www assets, example configuration, license, and installation documentation, plus published checksums. Upload reviewable CI artifacts; version-tag workflows publish GitHub Releases. Workflow execution/publication must be distinguished from local validation. User configuration and uploads are never included in release artifacts.

1. Capture legacy contracts and fixtures; implement Go configuration, data access, authentication, and compatibility handlers.
2. Implement safe streaming uploads/downloads, deletion recovery, and the versioned paginated explorer API.
3. Add collection membership APIs and reconciled storage statistics.
4. Initialize the exact shadcn preset, token overrides, dark-first themes, shared feature components, and responsive frontend flows.
5. Add browser preferences, selection previews, debounced search, upload queue, and PWA behavior.
6. Validate the replacement against v1-created database/file fixtures and package the executable, static www assets, service/container instructions, and upgrade/rollback procedure.

Regression tests must cover: existing bcrypt passwords including Unicode and long input; legacy BSON types and additional fields; existing JWTs and share URLs; every legacy operation; rejected duplicates preserving existing bytes; duplicates later in a multipart batch; cumulative upload limits; cancellation and interrupted writes; deletion failures and recovery; concurrency; disk/database failures; inline viewing and byte-range downloads; pagination stability; search cancellation and debounce; every filter/sort combination; collection ownership and multiple membership; nondestructive membership/collection removal; verified storage totals; preference isolation and restoration; both themes; mobile layouts; keyboard access; PWA install/offline/update behavior.

Evaluation evidence already gathered: Go verified synthetic legacy bcryptjs hashes; the current backend's duplicate-upload overwrite was reproduced with a temporary account; inline viewing passed a direct functional test; the legacy timezone-as-locale usage raises RangeError. These are evaluation results, not v2 implementation validation.
