# HTTP integration tests

The runner exercises the Go server over real HTTP against MongoDB. Python uses only its standard library. The small Node fixture package uses the official MongoDB driver; it does not install archived v1 dependencies or application frontend dependencies.

```sh
npm ci --prefix tests --ignore-scripts
cd v2/Back-End
go build -o /tmp/fileshare ./cmd/fileshare
cd ../..
MONGO_URI=mongodb://127.0.0.1:27017 python3 scripts/integration.py --binary /tmp/fileshare
```

Without `--binary`, the runner builds the backend with `go` (override with `GO=/path/to/go`). MongoDB must already be running. Use `--mongo-uri` or `MONGO_URI` for a CI MongoDB service; credentials remain in the environment and are not logged.

Each run creates a random `rfs_integration_<32 hex>` database and a temporary config, uploads tree, static directory, and backend process. Cleanup drops only that exact database after verifying its fixture ownership marker, terminates only the process it started, and removes its temporary tree. Never point the runner at production data. The URI's database path is replaced by the generated test database while connection options are retained.

The 23 groups cover legacy login/JWT/list/search/account/upload/delete/share compatibility, BSON preservation, cookie sessions and CSRF, ownership, pagination and filters/sorts, duplicate/oversize/cancelled upload rollback, concurrent collisions, Unicode and empty files, duplicate-reference deletion, inline-content isolation, disk failures and journal recovery after SIGKILL, stale deletion journals with replacement paths, exclusive runtime locking, Mongo insertion failures, collection membership, disk-reconciled storage, and password/logout invalidation including cookie JWT replay as Bearer. The database failure group temporarily sets a validation rule in the isolated fixture database and restores it in a `finally` block. A failed group does not suppress later independent groups. Exit status is 0 for all executed groups passing, 1 for regression failures, and 2 for setup failure. Browser-only accessibility, preferences, PWA, and upload-queue behavior belong to frontend tests.

`fixtures/legacy-accounts.json` contains synthetic passwords and bcryptjs 2.4.3 hashes generated with the archived v1 dependency. The Unicode password tests UTF-8 handling. The long password exceeds bcrypt's 72-byte limit and tests the compatibility truncation behavior. Mongo fixtures explicitly use BSON doubles for Mongoose Number fields, ObjectIDs, `__v`, optional fields, and unknown nested fields. They include stale file sizes, duplicate references to a shared path, a missing file, and an owned untracked file. No existing database or user data is imported.
