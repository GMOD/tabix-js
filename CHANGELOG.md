## [3.3.9](https://github.com/GMOD/tabix-js/compare/v3.3.8...v3.3.9) (2026-06-02)


### Bug Fixes

* remove dead unzipChunkSlice cache arg breaking the build ([#155](https://github.com/GMOD/tabix-js/issues/155)) ([f283ef3](https://github.com/GMOD/tabix-js/commit/f283ef39d8ea20162091228d8d6abb788505fab7))
* remove stale workflow query link from CI badge ([5001530](https://github.com/GMOD/tabix-js/commit/50015305ccfea8953ea95acab910a15806ba7a16))
* update CI badge to reference publish.yml workflow ([b58bfa2](https://github.com/GMOD/tabix-js/commit/b58bfa2a234103f34cb4895e64481cbf93e8bf36))

## [3.3.8](https://github.com/GMOD/tabix-js/compare/v3.3.7...v3.3.8) (2026-05-19)

## [3.3.7](https://github.com/GMOD/tabix-js/compare/v3.3.6...v3.3.7) (2026-05-19)

## [3.3.6](https://github.com/GMOD/tabix-js/compare/v3.3.5...v3.3.6) (2026-05-18)


### Reverts

* expand Chunk constructor back to explicit field declarations ([2b60715](https://github.com/GMOD/tabix-js/commit/2b6071562bb2fd54aea798ea29cd22439f038468))

## [3.3.5](https://github.com/GMOD/tabix-js/compare/v3.3.4...v3.3.5) (2026-05-18)


### Bug Fixes

* use Array.from({length}) to satisfy unicorn/no-new-array lint rule ([9f6294e](https://github.com/GMOD/tabix-js/commit/9f6294e04ad9425b852fde6d672a425bd8859628))


### Performance Improvements

* avoid per-query Chunk clones and tighten getLines hot loop ([2e4488b](https://github.com/GMOD/tabix-js/commit/2e4488bffaf51de85804260b45bede8ab81e1369))
* reduce allocations and move TextDecoder/TextEncoder to function scope ([3abb846](https://github.com/GMOD/tabix-js/commit/3abb846a9f0c5b6c5cbf4a73a13f9e84bf780922))


### Reverts

* inline tabix header parsing back into tbi.ts and csi.ts ([e7cdfd8](https://github.com/GMOD/tabix-js/commit/e7cdfd83f0d40ffc35447cfee4c8a2be130eff39))

## [3.3.4](https://github.com/GMOD/tabix-js/compare/v3.3.3...v3.3.4) (2026-05-08)

### Features

- expose bytesForRegions for byte-budget estimates
  ([c9ae5d4](https://github.com/GMOD/tabix-js/commit/c9ae5d4ca5121274a68c3d9c6bfd2f999b3b386f))

## [3.3.3](https://github.com/GMOD/tabix-js/compare/v3.3.2...v3.3.3) (2026-04-27)

### Bug Fixes

- add non-null assertions for noUncheckedIndexedAccess compliance
  ([645a56c](https://github.com/GMOD/tabix-js/commit/645a56c1b911704c6d0cb2f7b6f6bca651f278f9))

## [3.3.2](https://github.com/GMOD/tabix-js/compare/v3.3.1...v3.3.2) (2026-04-27)

## [3.3.1](https://github.com/GMOD/tabix-js/compare/v3.3.0...v3.3.1) (2026-03-28)

# [3.3.0](https://github.com/GMOD/tabix-js/compare/v3.2.2...v3.3.0) (2026-03-28)

## [3.2.2](https://github.com/GMOD/tabix-js/compare/v3.2.1...v3.2.2) (2025-12-24)

## [3.2.1](https://github.com/GMOD/tabix-js/compare/v3.2.0...v3.2.1) (2025-12-17)

# [3.2.0](https://github.com/GMOD/tabix-js/compare/v3.1.2...v3.2.0) (2025-12-11)

## [3.1.2](https://github.com/GMOD/tabix-js/compare/v3.1.1...v3.1.2) (2025-11-24)

## [3.1.1](https://github.com/GMOD/tabix-js/compare/v3.1.0...v3.1.1) (2025-11-19)

# [3.1.0](https://github.com/GMOD/tabix-js/compare/v3.0.5...v3.1.0) (2025-10-01)

## [3.0.5](https://github.com/GMOD/tabix-js/compare/v3.0.4...v3.0.5) (2025-05-26)

## [3.0.4](https://github.com/GMOD/tabix-js/compare/v3.0.3...v3.0.4) (2025-05-13)

## [3.0.3](https://github.com/GMOD/tabix-js/compare/v3.0.2...v3.0.3) (2025-05-13)

## [3.0.2](https://github.com/GMOD/tabix-js/compare/v3.0.1...v3.0.2) (2025-04-30)

## [3.0.1](https://github.com/GMOD/tabix-js/compare/v3.0.0...v3.0.1) (2025-04-30)

# [3.0.0](https://github.com/GMOD/tabix-js/compare/v2.0.5...v3.0.0) (2025-04-30)

## [2.0.5](https://github.com/GMOD/tabix-js/compare/v2.0.4...v2.0.5) (2025-03-18)

## [2.0.4](https://github.com/GMOD/tabix-js/compare/v2.0.3...v2.0.4) (2024-12-18)

## [2.0.3](https://github.com/GMOD/tabix-js/compare/v2.0.2...v2.0.3) (2024-12-18)

## [2.0.2](https://github.com/GMOD/tabix-js/compare/v2.0.0...v2.0.2) (2024-12-12)

# [2.0.0](https://github.com/GMOD/tabix-js/compare/v1.6.1...v2.0.0) (2024-12-12)

## [1.6.1](https://github.com/GMOD/tabix-js/compare/v1.6.0...v1.6.1) (2024-12-07)

# [1.6.0](https://github.com/GMOD/tabix-js/compare/v1.5.15...v1.6.0) (2024-11-30)

## [1.5.15](https://github.com/GMOD/tabix-js/compare/v1.5.14...v1.5.15) (2024-08-30)

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
