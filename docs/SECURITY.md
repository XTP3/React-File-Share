# V2.2.1 security update

V2.2.1 rebuilds the Go executable and static frontend with patched dependencies. Existing configuration, MongoDB records, upload paths, public links and API routes remain compatible; this update does not migrate or move stored files.

| Component | V2.2.0 | V2.2.1 |
| --- | --- | --- |
| Go toolchain | 1.27.1 | 1.27.3 |
| MongoDB Go driver | 2.3.1 | 2.9.2 |
| golang.org/x/image | 0.31.0 | 0.47.0 |
| golang.org/x/text | 0.29.0 | 0.43.0 |
| golang.org/x/crypto | 0.42.0 | 0.58.0 |
| golang.org/x/sys | 0.36.0 | 0.49.0 |
| CI/build Node | 24.19.0 | 24.22.1 |
| Vite | 8.3.2 | 8.3.5 |
| CI MongoDB service | 7.0.16 | 7.0.45 |

The updated Go binary addresses [excessive Range-header parsing](https://pkg.go.dev/vuln/GO-2026-6609), [multipart memory-limit bypass](https://pkg.go.dev/vuln/GO-2026-6608), the October HTTP/TLS fixes and [compromised intermediate certificate rejection](https://pkg.go.dev/vuln/GO-2026-6809). Updating Go installed on a server does not change an existing executable; install the new release bundle.

The image library update fixes [VP8L decoder memory exhaustion](https://pkg.go.dev/vuln/GO-2026-6222) and WebP decoder bugs. Thumbnail authorization, input/dimension limits, bounded concurrency and original-file preservation remain in place. The MongoDB driver update includes [CVE-2026-107325](https://www.cve.org/CVERecord?id=CVE-2026-107325) and [CVE-2026-107324](https://www.cve.org/CVERecord?id=CVE-2026-107324) BSON validation fixes; browser endpoints accept JSON/multipart data rather than raw BSON.

The shadcn component implementations are still checked in. Their required upstream stylesheet and MIT license are now checked in too; see [preset provenance](../v2/Front-End/SHADCN-PRESET.md). Normal builds no longer install the shadcn CLI, removing the dependency chains containing the unpatched [braces stack exhaustion issue](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) and affected [ip-address parser](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5). This removes those packages instead of suppressing the advisories. Release bundles include the stylesheet's license. Vite development binds localhost by default; intentional remote development can opt in with `npm run dev -- --host 0.0.0.0`.

Production serves a client-side React build through Go. It has no React Server Components, Server Functions or Next.js service, so the October RSC/Next.js server advisories do not affect this architecture. Node/Vite fixes protect development and build environments.

## Ongoing checks

The main build workflow runs `govulncheck` and npm audits for the frontend and test-fixture lockfiles before packaging. Any reported reachable Go vulnerability or npm audit failure blocks release bundles. A separate workflow repeats these checks weekly after the workflow reaches the repository's default branch, and supports manual dispatch. New vendor advisories still require review because vulnerability databases can lag.

The Go database flags the unused `golang.org/x/crypto/openpgp` package (GO-2026-5932) at module level. The app uses bcrypt from that module and does not import OpenPGP; the source scan has no vulnerable call path. The archived `v1/` reference code is excluded from v2 builds and these checks; its dependencies are not a supported production runtime.

## External services

This app update does not upgrade the separately managed production MongoDB, Nginx, OS or CA-certificate packages. Check their installed versions and vendor security updates on the appropriate hosts. The CI MongoDB pin is not evidence of a production database's version. MongoDB's [security alerts](https://www.mongodb.com/resources/products/alerts) and Nginx's [advisories](https://nginx.org/en/security_advisories.html) list applicable patch levels; distribution package revisions may include backported fixes.
