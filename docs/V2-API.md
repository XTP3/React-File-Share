# V2 integration contract

Go serves the SPA and APIs on one origin. Development frontend uses a Vite proxy to http://127.0.0.1:8080. Errors return `{ "error": "human-readable message" }` with appropriate non-2xx status. Browser requests use credentials and an X-CSRF-Token header for authenticated mutations. The login/me response supplies this token. Legacy Bearer endpoints remain supported.

## Authentication and configuration

- GET /api/v2/config -> `{version,maxUploadSize,dateLanguage,timeZone}` (public, no secrets).
- POST /api/v2/auth/register `{username,password,creationCode}` -> 201.
- POST /api/v2/auth/login `{username,password}` -> `{user:{uniqueID,username},csrfToken}` and HttpOnly cookie.
- GET /api/v2/auth/me -> `{user:{uniqueID,username},csrfToken}` or 401.
- POST /api/v2/auth/logout -> 200 and cleared cookie.
- POST /api/v2/account/password `{currentPassword,newPassword}` -> 200 and logout.

## Files

File JSON retains `_id, uniqueID, fileName, fileSize, fileType, uploaderID, timeOfUpload, timeOfUploadDate`, and adds derived `category` in v2 responses only. Categories: photo, gif, video, audio, document, archive, other. GIF is separate from photo; archives include ZIP. No rewrite of legacy records is required.

- GET /api/v2/files query: `page` (default 1), `pageSize` (default 25/max 100), `q`, `sort` (name/date/size/type), `direction` (asc/desc), `category` (comma-separated OR), `minSize`, `maxSize`, `from`, `to` (epoch milliseconds), `collectionId` (ID or uncollected). Different dimensions combine with AND. -> `{items,total,page,pageSize,totalPages}`; empty results use 200/items [].
- POST /api/v2/files/upload multipart files -> 200 `{files:[File]}`. Each request can contain multiple parts; limit is aggregate file bytes. UI may send bounded concurrent single-file requests. No overwrite on conflicts (409). Cancelled or rejected batches clean up all newly staged data. Optional `collectionId` query assigns successful uploads to that owned collection.
- DELETE /api/v2/files/:id -> 200.
- Public GET /f/d/:id (download) and /f/v/:id (inline view) preserve v1 URLs, support range requests, and never require a cookie.

## Collections

- GET /api/v2/collections -> `{items:[Collection]}`.
- POST /api/v2/collections `{title}` -> 201 Collection.
- PATCH /api/v2/collections/:id `{title}` -> Collection.
- DELETE /api/v2/collections/:id -> 200; preserves underlying files.
- POST /api/v2/collections/:id/files `{fileIds:[uniqueID]}` -> 200; idempotent bulk add.
- DELETE /api/v2/collections/:id/files `{fileIds:[uniqueID]}` -> 200; removes memberships only.
- Collection JSON: `{id,title,createdAt,updatedAt,fileCount,totalBytes}`.
- Listing inside collections uses GET /api/v2/files?collectionId=ID with the same filters/sort/pagination.

## Storage

- GET /api/v2/storage, optional `collectionId`, -> `{totalBytes,totalFiles,categories:[{category,count,bytes}],updatedAt,missingFiles,untrackedBytes}`. Global bytes come from reconciled logical file sizes on disk, count each path once, and include owned untracked file bytes. Collection totals count its distinct visible member paths. Global cards do not change with explorer filters. Cache scans and invalidate on file mutations.
- POST /api/v2/storage/refresh -> same shape, forces reconciliation.

## Build and runtime contract

Backend module in v2/Back-End, main executable package `./cmd/fileshare`, Go pinned supported stable release. Frontend in v2/Front-End, npm ci; npm run build emits ../Back-End/www. Go serves configured www path and SPA deep links. Flags: --config (legacy Config.json), --uploads-dir, --www-dir, --http-port, --https-port. Paths default relative to the selected config file or backend working directory. Releases contain backend executable, www, Config.example.json, LICENSE, and installation docs; never overwrite user Config.json or uploads.

Root agent owns this contract. Communicate necessary deviations before changing it so frontend, tests and packaging stay aligned.
