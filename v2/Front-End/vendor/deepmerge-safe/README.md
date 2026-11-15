# Local security patch for deepmerge 4.3.1

This package contains the MIT-licensed `dist/cjs.js` distribution from
[`deepmerge@4.3.1`](https://registry.npmjs.org/deepmerge/-/deepmerge-4.3.1.tgz),
renamed to `@xtp3/deepmerge-safe` to identify the maintained local fork. The
original copyright and license are preserved in `LICENSE`.

At the time of this patch, upstream has not published a fix for
[GHSA-gcqx-w48m-w2h4 / CVE-2026-93753](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
The returned object's prototype can be poisoned when mergeObject copies an
enumerable `__proto__` from the target, or from a source when the target has a
null prototype. Existing source-key checks do not protect every write.

The only functional patch is `setEnumerableDataProperty`: all three assignments
to `destination[key]` now define an enumerable, writable, configurable own data
property using `Object.defineProperty`. This preserves ordinary merging, arrays,
symbols, custom options, and the exported function/`.all` API while preventing
an inherited setter from changing the destination's prototype. The regression
tests reproduce the upstream target/source cases and check the installed fork.

`@rollup/plugin-node-resolve`, used by Workbox during the PWA build, is the only
consumer. A direct local development dependency plus the `$deepmerge` override
ensures both the resolver and regression tests load this package. No runtime
application dependency or audit exclusion is added. Replace this fork with a
verified upstream fixed release when one becomes available.
