# React File Share

Self-hosted file sharing with a Go server, React/TypeScript interface and MongoDB. V2 serves its static frontend and API from one executable; Node is needed only to build the frontend.

V2 preserves the existing MongoDB users/files, upload paths, password hashes and public share URLs. It adds collections with multiple membership, paginated search and filters, storage statistics, upload previews, dark/light themes and an installable PWA.

- [Install and build v2](docs/INSTALL.md)
- [Upgrade and roll back an existing installation](docs/UPGRADE.md)
- [V2 development](v2/README.md)
- [API contract](docs/V2-API.md) and [implementation plan](docs/V2-PLAN.md)
- [Archived v1 source and original instructions](v1/README.md)

The `v1/` directory preserves the original application as a compatibility reference. V2 builds independently from `v2/Back-End` and `v2/Front-End`.

GitHub Actions runs native Go unit tests on Linux, Windows and macOS, plus frontend, browser and legacy compatibility checks on Linux, then uploads bundles for Linux amd64/arm64, Windows amd64 and macOS amd64/arm64. Pushing a `v2.*` tag publishes those bundles and `SHA256SUMS` to a GitHub release after checks pass. Generated assets, local configuration and uploaded data are excluded from source control and release bundles.

Licensed under the [MIT License](LICENSE).
