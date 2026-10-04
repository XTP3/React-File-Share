# Upgrade from v1 and roll back

V2 uses the existing MongoDB database and `uploads/<user uniqueID>/<filename>` layout. It accepts legacy `Back-End/Config.json`, existing bcrypt passwords and unexpired bearer tokens, and preserves `/f/v/:id` and `/f/d/:id` public links. No mandatory password reset, record conversion or file move is required. New collection/membership/recovery records are additive.

Use v2.0.1 or later when upgrading a database with existing indexes. V2.0.0 can fail startup with `IndexKeySpecsConflict` if a lookup index is already unique. V2.0.1 preserves existing lookup index names and options and adds missing indexes. Do not drop unique indexes to work around the v2.0.0 error.

Moving source code under `v1/` does not move your deployed data. Record the actual configuration, database and uploads paths, service account, public hostname, TLS paths, proxy configuration and running v1 version before changing deployment. Preserve the archived v1 application and its dependencies for rollback. Stage the v2 bundle in a new directory alongside the current deployment.

1. Announce a maintenance window and block new writes at the proxy. Stop the old server and ensure there are no active upload/delete operations. Do not run v1 and v2 writers simultaneously against the same data.
2. With application writes stopped, take a coordinated MongoDB dump and uploads filesystem backup/snapshot. Include the configuration, TLS/proxy settings and the whole uploads tree. Check that the backups are readable, record their time and test your restore procedure on an isolated database/path. A database dump without matching file bytes is not a complete backup.
3. Reuse the original `Config.json` without changing `JWT_SECRET_KEY`, account IDs, database name or upload layout. Preserve any legacy relative-path semantics by supplying explicit absolute `--uploads-dir` and `--www-dir` paths and making certificate paths absolute in a separate reviewed configuration copy if needed. Keep the original configuration intact. For HTTPS terminated by a reverse proxy, set SECURE_COOKIES true and configure explicit ALLOWED_ORIGINS in a reviewed configuration copy as described in INSTALL.md.
4. Start only v2 with the existing data and the new frontend directory:

   ```sh
   /opt/fileshare-v2/fileshare \
     --config /path/to/existing/Back-End/Config.json \
     --uploads-dir /path/to/existing/Back-End/uploads \
     --www-dir /opt/fileshare-v2/www
   ```

   Use the existing HTTP/HTTPS configuration or explicit port overrides as documented in INSTALL.md. Ensure its service user can read existing files and write staging/recovery files without recursively replacing production ownership or permissions.
5. Before reopening writes, verify an existing user's login, legacy file list, old view/download URLs, byte-range downloads, expected filenames and storage totals. Test with a dedicated account: upload a new small file, reject a duplicate without changing the original bytes, create a collection, add/remove membership, delete the collection while preserving its file, then delete the test file. Validate the deployed public host and TLS, browser navigation and upload limit. Keep evidence of the checks and backups.
6. Reopen writes and monitor logs, disk space, interrupted operations and storage reconciliation. Do not remove v1 or the backup until the upgrade is accepted.

Existing stored date strings are retained. Newly uploaded files use localized date strings for common supported locales; other locales fall back to ISO formatting. DATE_TIMEZONE_REGION remains the timezone setting. Check the desired locale with a test upload before reopening writes.

Missing or orphaned files reported during reconciliation require investigation. Reconciliation must not be used as a reason to globally rewrite legacy records or delete unmatched production data.

## Rollback

Block writes, stop v2 and confirm no writer remains. If the shared data is healthy, start the preserved v1 server against its original configuration, the same database and upload path. V1 ignores v2's auxiliary collections; do not delete these blindly. Restore the prior proxy/service routing and test existing login/share URLs before reopening writes. Keep original JWT secrets so compatible unexpired tokens remain valid.

If data restoration is necessary, restore the coordinated database and filesystem snapshot together into isolated locations first, verify it, then switch the stopped service to those matching locations. Restoration to the pre-upgrade snapshot loses all writes since that snapshot: preserve the current database/files separately and agree on recovery before replacing live data. Never restore only the database or only the files, and never perform a global production search-and-replace as an upgrade step.
