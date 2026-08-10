## [3.7.3](https://github.com/GMOD/tabix-js/compare/v3.7.2...v3.7.3) (2026-08-10)

## [3.7.2](https://github.com/GMOD/tabix-js/compare/v3.7.1...v3.7.2) (2026-08-10)

### Chores

- Gate preversion on format:check, as CI does
- Gate preversion on typecheck too, as CI does
- Converge package.json on the shape its siblings use

### Other Changes

- Revert "chore: converge package.json" — the CHANGELOG prettier step

Removes `prettier --write CHANGELOG.md` from the `version` script, which the
previous commit added on a premise I did not check.

The reasoning was: git-cliff writes CHANGELOG.md after `preversion` has run, so
the format:check gate structurally cannot see it, while CI checks it on the tag
commit -- a hole the gate cannot cover. The first half is true. The second is
not: **every one of the 20 repos already lists CHANGELOG.md in
.prettierignore**, so CI's format:check skips it too and there was never a hole.

The step was also a no-op, verified rather than assumed: prettier skips an
ignored file even when it is named explicitly on the command line, so a
deliberately mangled CHANGELOG.md came back unchanged.

hclust was the only repo that had this step, which is where I copied it from.
It is reverted there too. The .prettierignore comments in bgzf-filehandle,
cram-js and hclust say why nobody should add it back: reformatting a generated
changelog fights the generator on every release.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>

## [3.7.1](https://github.com/GMOD/tabix-js/compare/v3.7.0...v3.7.1) (2026-08-10)

### Chores

- Prettier the docs added in 844872d

## [3.7.0](https://github.com/GMOD/tabix-js/compare/v3.6.1...v3.7.0) (2026-08-10)

### Documentation

- Record the two rejected refactors and the htslib differential harness

### Features

- ChunkCacheBudget, so several files can share one ceiling

## [3.6.1](https://github.com/GMOD/tabix-js/compare/v3.6.0...v3.6.1) (2026-08-09)

### Bug Fixes

- Bump @gmod/shared-read-cache to 1.4.4

### Documentation

- ADR 0002 — size the chunk cache above one query

### Refactoring

- The header and index parses are shared reads, not memos

## [3.6.0](https://github.com/GMOD/tabix-js/compare/v3.5.7...v3.6.0) (2026-08-06)

### Bug Fixes

- A bystander no longer inherits the header parse owner's abort

### Chores

- Type-check the tests and enforce prettier, as @gmod/bam does
- Let npm publish stop auto-correcting repository.url
- Bump pnpm/action-setup to v6.0.10
- Run the test suite as `pnpm test --run`

### Performance Improvements

- Size the chunk cache above one query, and reclaim it when idle

### Refactoring

- Align the shared-read abort plumbing with @gmod/bam
- **BREAKING** Drop @gmod/abortable-promise-cache for a local ChunkCache
- Use @gmod/shared-read-cache for the chunk cache

## [3.5.7](https://github.com/GMOD/tabix-js/compare/v3.5.6...v3.5.7) (2026-08-05)

### Tests

- Use a fixture that is actually tracked in git

## [3.5.6](https://github.com/GMOD/tabix-js/compare/v3.5.5...v3.5.6) (2026-08-05)

### Bug Fixes

- A bystander no longer inherits the index parse owner's abort

### Chores

- Drop eslint-plugin-unicorn

### Tests

- Make GatedIndexFile actually satisfy GenericFilehandle

## [3.5.5](https://github.com/GMOD/tabix-js/compare/v3.5.4...v3.5.5) (2026-08-04)

### Bug Fixes

- Stop returning lines twice when a query's chunks overlap

### Tests

- Cover getHeaderLines for a file that keeps no header either way

## [3.5.4](https://github.com/GMOD/tabix-js/compare/v3.5.3...v3.5.4) (2026-08-04)

### Chores

- Depend on @gmod/bgzf-filehandle 6.3.2

### Features

- GetHeaderLines, and one read of the header instead of two

## [3.5.3](https://github.com/GMOD/tabix-js/compare/v3.5.2...v3.5.3) (2026-08-04)

### Chores

- Replace standard-changelog with git-cliff for changelog generation

### Documentation

- Correct stale README facts and drop the README generator
- Backfill blank CHANGELOG.md entries from git history
- Mark breaking changes in the generated changelog

### Features

- GetSkippedLines, for a header the index counted rather than commented

### Tests

- Pin getHeader to `tabix -H` semantics for a `skip`-counted header

## [3.5.2](https://github.com/GMOD/tabix-js/compare/v3.5.1...v3.5.2) (2026-07-31)

### Bug Fixes

* default the chunk cache to 100MB, and correct why entries get large ([4936495](https://github.com/GMOD/tabix-js/commit/4936495ac588687e1665b0be55661b63c79daa10))

### Performance Improvements

* bound the chunk cache by decompressed bytes, not entry count ([25783a1](https://github.com/GMOD/tabix-js/commit/25783a16b6977c72aa15d18550d07176dfb29de1))
* find firstDataLine without allocating a VirtualOffset per index entry ([e5173e4](https://github.com/GMOD/tabix-js/commit/e5173e4fbc6bcb9562dfbfcc1e13a423a2530c69))

## [3.5.1](https://github.com/GMOD/tabix-js/compare/v3.5.0...v3.5.1) (2026-07-31)

### Bug Fixes

* satisfy eslint-plugin-unicorn 72 ([fd12751](https://github.com/GMOD/tabix-js/commit/fd127514cb685238f8b2de4640a4103ad37c0cee)), closes [#private](https://github.com/GMOD/tabix-js/issues/private)

### Performance Improvements

* read a query's chunks ahead, as far as the scan earns ([8340c33](https://github.com/GMOD/tabix-js/commit/8340c33a95929402fc49c87a12ea34f714ec21a0))

# [3.5.0](https://github.com/GMOD/tabix-js/compare/v3.4.3...v3.5.0) (2026-07-25)

### Features

- prune CSI chunks using per-bin loffset
  ([2377ef8](https://github.com/GMOD/tabix-js/commit/2377ef8059d7736f9f7489579129a56cad557b66))

## [3.4.3](https://github.com/GMOD/tabix-js/compare/v3.4.2...v3.4.3) (2026-07-25)

### Bug Fixes

- match htslib query semantics for TBI indexes
  ([c8c8e4c](https://github.com/GMOD/tabix-js/commit/c8c8e4cf261253304ce25f071f6da512c28f043d))

## [3.4.2](https://github.com/GMOD/tabix-js/compare/v3.4.1...v3.4.2) (2026-06-25)

### Features

- tighten index byte-size estimate by clamping chunk ends to next block boundary
  ([ea67e96](https://github.com/GMOD/tabix-js/commit/ea67e96607877ecacd3aab2a06c78b581fb8e972))

## [3.4.1](https://github.com/GMOD/tabix-js/compare/v3.4.0...v3.4.1) (2026-06-19)

### Features

- report .tbi/.csi index download progress via onProgress
  ([23de497](https://github.com/GMOD/tabix-js/commit/23de497ee9fb2936154100f1667e940d6cbba095))

# [3.4.0](https://github.com/GMOD/tabix-js/compare/v3.3.9...v3.4.0) (2026-06-18)

### Features

- report download progress from getLines via onProgress
  ([3e166b8](https://github.com/GMOD/tabix-js/commit/3e166b83955bd3e7cad9883508a498d2c68ad4c6))

## [3.3.9](https://github.com/GMOD/tabix-js/compare/v3.3.8...v3.3.9) (2026-06-02)

### Bug Fixes

- remove dead unzipChunkSlice cache arg breaking the build
  ([#155](https://github.com/GMOD/tabix-js/issues/155))
  ([f283ef3](https://github.com/GMOD/tabix-js/commit/f283ef39d8ea20162091228d8d6abb788505fab7))
- remove stale workflow query link from CI badge
  ([5001530](https://github.com/GMOD/tabix-js/commit/50015305ccfea8953ea95acab910a15806ba7a16))
- update CI badge to reference publish.yml workflow
  ([b58bfa2](https://github.com/GMOD/tabix-js/commit/b58bfa2a234103f34cb4895e64481cbf93e8bf36))

## [3.3.8](https://github.com/GMOD/tabix-js/compare/v3.3.7...v3.3.8) (2026-05-19)

- ci: rename the merged workflow back to `publish.yml` — npm's OIDC
  trusted-publishing config pins to that exact file path

## [3.3.7](https://github.com/GMOD/tabix-js/compare/v3.3.6...v3.3.7) (2026-05-19)

- ci: fold the publish workflow into `push.yml`, gated on the test job
  succeeding first

## [3.3.6](https://github.com/GMOD/tabix-js/compare/v3.3.5...v3.3.6) (2026-05-18)

### Reverts

- expand Chunk constructor back to explicit field declarations
  ([2b60715](https://github.com/GMOD/tabix-js/commit/2b6071562bb2fd54aea798ea29cd22439f038468))

## [3.3.5](https://github.com/GMOD/tabix-js/compare/v3.3.4...v3.3.5) (2026-05-18)

### Bug Fixes

- use Array.from({length}) to satisfy unicorn/no-new-array lint rule
  ([9f6294e](https://github.com/GMOD/tabix-js/commit/9f6294e04ad9425b852fde6d672a425bd8859628))

### Performance Improvements

- avoid per-query Chunk clones and tighten getLines hot loop
  ([2e4488b](https://github.com/GMOD/tabix-js/commit/2e4488bffaf51de85804260b45bede8ab81e1369))
- reduce allocations and move TextDecoder/TextEncoder to function scope
  ([3abb846](https://github.com/GMOD/tabix-js/commit/3abb846a9f0c5b6c5cbf4a73a13f9e84bf780922))

### Reverts

- inline tabix header parsing back into tbi.ts and csi.ts
  ([e7cdfd8](https://github.com/GMOD/tabix-js/commit/e7cdfd83f0d40ffc35447cfee4c8a2be130eff39))

## [3.3.4](https://github.com/GMOD/tabix-js/compare/v3.3.3...v3.3.4) (2026-05-08)

### Features

- expose bytesForRegions for byte-budget estimates
  ([c9ae5d4](https://github.com/GMOD/tabix-js/commit/c9ae5d4ca5121274a68c3d9c6bfd2f999b3b386f))

## [3.3.3](https://github.com/GMOD/tabix-js/compare/v3.3.2...v3.3.3) (2026-04-27)

### Bug Fixes

- add non-null assertions for noUncheckedIndexedAccess compliance
  ([645a56c](https://github.com/GMOD/tabix-js/commit/645a56c1b911704c6d0cb2f7b6f6bca651f278f9))

## [3.3.2](https://github.com/GMOD/tabix-js/compare/v3.3.1...v3.3.2) (2026-04-27)

- Multiple README clarity and doc-error fixes; correct the `lineCount`
  docs (count is exact, not approximate); add JSDoc so auto-generated API
  docs pick it up
- Routine dependency bumps

## [3.3.1](https://github.com/GMOD/tabix-js/compare/v3.3.0...v3.3.1) (2026-03-28)

- Export the `VirtualOffset` type from the package entrypoint
- Fix the npm trusted-publishing workflow (remove a now-invalid token
  override and provenance flag)
- README cleanups

# [3.3.0](https://github.com/GMOD/tabix-js/compare/v3.2.2...v3.3.0) (2026-03-28)

- perf: scan for tabs with `Uint8Array.indexOf`, and parse VCF
  `SVTYPE=TRA`/`END=` INFO fields in a single pass instead of two
- refactor: simplify `tabixIndexedFile.ts` by extracting standalone helper
  functions and inlining the line-check loop
- chore: switch from yarn to pnpm; upgrade TypeScript to v6 with
  `nodenext` module resolution; tighten the ESLint config (no `any`,
  consistent type imports, etc.)
- ci: add an npm publish workflow using OIDC trusted publishing
- docs: add CONTRIBUTING.md

## [3.2.2](https://github.com/GMOD/tabix-js/compare/v3.2.1...v3.2.2) (2025-12-24)

- Rework `checkLine` to take precomputed column/format constants instead of
  the metadata object, hoisting per-call work out of the `getLines` hot
  loop, and extend the `getLines` callback with parsed start/end
  coordinates
- Reorganize benchmarks into `benchmarks/`, adding a dedicated `checkLine`
  benchmark suite

## [3.2.1](https://github.com/GMOD/tabix-js/compare/v3.2.0...v3.2.1) (2025-12-17)

- Bump `quick-lru` to a current major version

# [3.2.0](https://github.com/GMOD/tabix-js/compare/v3.1.2...v3.2.0) (2025-12-11)

- Migrate to the WASM-based `@gmod/bgzf-filehandle` for bgzf decompression
  (#153)

## [3.1.2](https://github.com/GMOD/tabix-js/compare/v3.1.1...v3.1.2) (2025-11-24)

- Routine dependency bumps (`@gmod/bgzf-filehandle`); switch to yarn

## [3.1.1](https://github.com/GMOD/tabix-js/compare/v3.1.0...v3.1.1) (2025-11-19)

- Eliminate a regex-based ASCII check from the `getLines` hot path (#152);
  add a CPU profiling script for benchmarking

# [3.1.0](https://github.com/GMOD/tabix-js/compare/v3.0.5...v3.1.0) (2025-10-01)

- Add an in-memory LRU cache for decompressed bgzf blocks, avoiding
  redundant unzips on repeated reads

## [3.0.5](https://github.com/GMOD/tabix-js/compare/v3.0.4...v3.0.5) (2025-05-26)

- Bump `@gmod/bgzf-filehandle`

## [3.0.4](https://github.com/GMOD/tabix-js/compare/v3.0.3...v3.0.4) (2025-05-13)

- Restore a webpack config for browser bundle builds

## [3.0.3](https://github.com/GMOD/tabix-js/compare/v3.0.2...v3.0.3) (2025-05-13)

- Add a `postbuild` script

## [3.0.2](https://github.com/GMOD/tabix-js/compare/v3.0.1...v3.0.2) (2025-04-30)

- Bump `@gmod/abortable-promise-cache` and `@gmod/bgzf-filehandle` to their
  ESM-only major versions

## [3.0.1](https://github.com/GMOD/tabix-js/compare/v3.0.0...v3.0.1) (2025-04-30)

- Bump `generic-filehandle2`

# [3.0.0](https://github.com/GMOD/tabix-js/compare/v2.0.5...v3.0.0) (2025-04-30)

- Switch to a pure-ESM package build (#151) — breaking change, hence the
  major version bump

## [2.0.5](https://github.com/GMOD/tabix-js/compare/v2.0.4...v2.0.5) (2025-03-18)

- Update README for the `generic-filehandle2` migration; tighten the
  `Options` type by dropping its arbitrary-key index signature

## [2.0.4](https://github.com/GMOD/tabix-js/compare/v2.0.3...v2.0.4) (2024-12-18)

- Drop `longfn` too, in favor of a small inline 64-bit unsigned-integer
  parser

## [2.0.3](https://github.com/GMOD/tabix-js/compare/v2.0.2...v2.0.3) (2024-12-18)

- Replace the `long` dependency with the smaller `longfn` package for
  parsing pseudo-bin line counts

## [2.0.2](https://github.com/GMOD/tabix-js/compare/v2.0.0...v2.0.2) (2024-12-12)

- Bump `generic-filehandle2` to its stable release

# [2.0.0](https://github.com/GMOD/tabix-js/compare/v1.6.1...v2.0.0) (2024-12-12)

- Migrate from `generic-filehandle` to `generic-filehandle2` (#150) —
  breaking change, hence the major version bump

## [1.6.1](https://github.com/GMOD/tabix-js/compare/v1.6.0...v1.6.1) (2024-12-07)

- Pin typescript to `~5.6` to fix broken `.d.ts` generation

# [1.6.0](https://github.com/GMOD/tabix-js/compare/v1.5.15...v1.6.0) (2024-11-30)

- Optimize `getLines` for large GWAS-style tabix files (#148)

## [1.5.15](https://github.com/GMOD/tabix-js/compare/v1.5.14...v1.5.15) (2024-08-30)

- Add a single-file minified browser bundle via webpack, with new usage
  examples

## [1.5.14](https://github.com/GMOD/tabix-js/compare/v1.5.13...v1.5.14) (2024-07-23)

### Reverts

- Revert "Bump to eslint 9"
  ([9bd49b1](https://github.com/GMOD/tabix-js/commit/9bd49b1132f632b0e7847d9b95cf3cb08c424360))

## [1.5.13](https://github.com/GMOD/tabix-js/compare/v1.5.12...v1.5.13) (2024-01-09)

- Another fix for abort signal in getLines

## [1.5.12](https://github.com/GMOD/tabix-js/compare/v1.5.11...v1.5.12) (2024-01-09)

- Add missing abort signal to the @gmod/abortable-promise-cache fetch for tabix
  chunks (#143)

## [1.5.11](https://github.com/GMOD/tabix-js/compare/v1.5.10...v1.5.11) (2023-07-10)

### Features

- explicit buffer import ([#140](https://github.com/GMOD/tabix-js/issues/140))
  ([fb80ac8](https://github.com/GMOD/tabix-js/commit/fb80ac813a0d40255556de3ab28dae1940f59c1d))

* Add explicit buffer import

## [1.5.10](https://github.com/GMOD/tabix-js/compare/v1.5.9...v1.5.10) (2023-03-30)

- Remove stray console.log

## [1.5.9](https://github.com/GMOD/tabix-js/compare/v1.5.8...v1.5.9) (2023-03-27)

- Revert the Buffer::slice -> Buffer::subarray change due to use with polyfills

## [1.5.8](https://github.com/GMOD/tabix-js/compare/v1.5.7...v1.5.8) (2023-03-24)

- Make yieldTime optional

## [1.5.7](https://github.com/GMOD/tabix-js/compare/v1.5.6...v1.5.7) (2023-03-24)

- Add yieldTime parameter
- Improve typescripting

## [1.5.6](https://github.com/GMOD/tabix-js/compare/v1.5.5...v1.5.6) (2023-02-28)

- Add fix for fileOffset being stable in presence of Unicode characters (#137)

## [1.5.5](https://github.com/GMOD/tabix-js/compare/v1.5.4...v1.5.5) (2022-12-17)

- Use es2015 for nodejs build

## [1.5.4](https://github.com/GMOD/tabix-js/compare/v1.5.3...v1.5.4) (2022-07-18)

- Bump generic-filehandle 2->3

## [1.5.3](https://github.com/GMOD/tabix-js/compare/v1.5.2...v1.5.3) (2022-04-25)

- Fix esm module build to use ESM instead of CJS

<a name="1.5.2"></a>

## [1.5.2](https://github.com/GMOD/tabix-js/compare/v1.5.1...v1.5.2) (2021-12-15)

- Change typescript signature of lineCallback from Promise<void> to void

<a name="1.5.1"></a>

## [1.5.1](https://github.com/GMOD/tabix-js/compare/v1.5.0...v1.5.1) (2021-12-15)

- Add esm module with less babelification for smaller bundle size

<a name="1.5.0"></a>

# [1.5.0](https://github.com/GMOD/tabix-js/compare/v1.4.6...v1.5.0) (2020-12-11)

- Use TextDecoder for chunk decoding for small speedup
- Use canMergeChunks logic to avoid too large of chunks being used
- Use time based yield instead of number-of-line based yield

<a name="1.4.6"></a>

## [1.4.6](https://github.com/GMOD/tabix-js/compare/v1.4.5...v1.4.6) (2020-04-30)

- Fix regression with browser only version of tabix-js not being able to parse
  results in 1.4.5

<a name="1.4.5"></a>

## [1.4.5](https://github.com/GMOD/tabix-js/compare/v1.4.4...v1.4.5) (2020-04-28)

- Remove the filehandle size() call because this is unnecessary and would
  indicate a corrupt index, and because it additionally has a CORS configuration
  overhead

<a name="1.4.4"></a>

## [1.4.4](https://github.com/GMOD/tabix-js/compare/v1.4.3...v1.4.4) (2020-04-06)

- Fix usage of tabix where start column and end column are the same

<a name="1.4.3"></a>

## [1.4.3](https://github.com/GMOD/tabix-js/compare/v1.4.2...v1.4.3) (2020-02-04)

- Fix optional param for constructor for typescript
- Update method of calculating fileOffset based IDs using updated
  @gmod/bgzf-filehandle

<a name="1.4.2"></a>

## [1.4.2](https://github.com/GMOD/tabix-js/compare/v1.4.1...v1.4.2) (2020-02-01)

- Fix usage of renameRefSeqs callback

<a name="1.4.1"></a>

## [1.4.1](https://github.com/GMOD/tabix-js/compare/v1.4.0...v1.4.1) (2020-02-01)

- Remove a runtime dependency on a @types module

<a name="1.4.0"></a>

# [1.4.0](https://github.com/GMOD/tabix-js/compare/v1.3.2...v1.4.0) (2020-02-01)

- Add typescripting of the codebase
- Drop Node 6 support due to changes in our dependencies

<a name="1.3.2"></a>

## [1.3.2](https://github.com/GMOD/tabix-js/compare/v1.3.1...v1.3.2) (2019-11-01)

- Make <TRA> SVs to ignore their usage of the END= INFO field going with the
  since it refers to the other side of a translocation
- Make stable fileOffset based IDs

<a name="1.3.1"></a>

## [1.3.1](https://github.com/GMOD/tabix-js/compare/v1.3.0...v1.3.1) (2019-10-06)

- Small refactor of `filehandle.read()` to make it more robust

<a name="1.3.0"></a>

# [1.3.0](https://github.com/GMOD/tabix-js/compare/v1.2.0...v1.3.0) (2019-08-08)

- Add ability to pass an AbortSignal from an AbortController to `getLines()`

<a name="1.2.0"></a>

# [1.2.0](https://github.com/GMOD/tabix-js/compare/v1.1.8...v1.2.0) (2019-07-05)

- Add ability for `getLines` to be open-ended. With no `end`, getlines continues
  until the end of the sequence.

<a name="1.1.8"></a>

## [1.1.8](https://github.com/GMOD/tabix-js/compare/v1.1.7...v1.1.8) (2019-06-06)

- Add a fix for a bgzf unzipping thing that could result in duplicate features
  being returned

## [1.1.7](https://github.com/GMOD/tabix-js/compare/v1.1.6...v1.1.7) (2019-06-04)

- Removed chunk merging from header file parsing which now results in smaller
  bgzf unzip calls being streamed out to clients

## [1.1.6](https://github.com/GMOD/tabix-js/compare/v1.1.5...v1.1.6) (2019-05-31)

- Fix issue with headerless files returning data lines in header
- Use generic-filehandle for localFile

## [1.1.5](https://github.com/GMOD/tabix-js/compare/v1.1.4...v1.1.5) (2019-03-05)

- Fix parsing on a tabix file that should be csi files (e.g. too long of
  chromosomes)

## [1.1.4](https://github.com/GMOD/tabix-js/compare/v1.1.3...v1.1.4) (2019-02-23)

- Upgrade to babel 7

## [1.1.3](https://github.com/GMOD/tabix-js/compare/v1.1.2...v1.1.3) (2018-11-23)

- Change to es6-promisify and quick-lru which can be babelified to IE11
  (util.promisify and lru-cache used Object.defineProperty('length', ...))

## [1.1.2](https://github.com/GMOD/tabix-js/compare/v1.1.1...v1.1.2) (2018-10-26)

- Add VCF info field END= parsing and other file offset improvements
- Treats VCF type differently from generic type tabix files

## [1.1.1](https://github.com/GMOD/tabix-js/compare/v1.1.0...v1.1.1) (2018-10-05)

- Trim output to avoid CRLF in output

## [1.1.0](https://github.com/GMOD/tabix-js/compare/v1.0.2...v1.1.0) (2018-09-24)

- Use custom bgzf block unzipping function
- Fixes to avoid duplicate lines in output

## [1.0.2](https://github.com/GMOD/tabix-js/compare/v1.0.1...v1.0.2) (2018-09-18)

- Implement better lineCount function from tbi/csi pseudobin
- Fix first data line finding with very large header tabix files

## [1.0.1](https://github.com/GMOD/tabix-js/compare/v1.0.0...v1.0.1) (2018-09-15)

- Add renameRefSeqs handling
- Fix some blocksForRange

# 1.0.0 (2018-09-09)

- Initial release
