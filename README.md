# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/tabix-js/publish.yml?branch=main)

Read Tabix-indexed files using either .tbi or .csi indexes.

## Install

```bash
npm install @gmod/tabix
```

## Usage

```typescript
import { TabixIndexedFile } from '@gmod/tabix'

// Local file — TBI index assumed at path + '.tbi'
const file = new TabixIndexedFile({ path: 'file.vcf.gz' })

// CSI index
const csi = new TabixIndexedFile({
  path: 'file.vcf.gz',
  csiPath: 'file.vcf.gz.csi',
})

// Remote files: one HTTP request per read
const remote = new TabixIndexedFile({
  url: 'https://example.com/file.vcf.gz',
  tbiUrl: 'https://example.com/file.vcf.gz.tbi',
})

// Remote files through a range cache (recommended)
import { RemoteFileWithRangeCache } from '@gmod/range-cache-filehandle'

const cached = new TabixIndexedFile({
  filehandle: new RemoteFileWithRangeCache('https://example.com/file.vcf.gz'),
  tbiFilehandle: new RemoteFileWithRangeCache(
    'https://example.com/file.vcf.gz.tbi',
  ),
})
```

A bare `url` sends one request per read and caches nothing.
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle)
merges neighboring blocks into one request and fetches each byte once. Without
it, twenty half-overlapping windows panned across the 3.4 MB test BED file read
11 MB.

### getLines

Fetches lines overlapping a region. `start`/`end` are 0-based half-open
coordinates (unlike the tabix CLI which uses 1-based closed).

```typescript
const lines: string[] = []
await file.getLines('chr1', 200, 300, line => lines.push(line))
```

The callback also receives the virtual file offset and parsed coordinates for
the line:

```typescript
await file.getLines('chr1', 200, 300, (line, fileOffset, start, end) => {
  lines.push(line)
})
```

Pass an options object instead of a bare callback to abort the query or track
download progress:

```typescript
const aborter = new AbortController()
await file.getLines('chr1', 200, 300, {
  lineCallback: (line, fileOffset, start, end) => lines.push(line),
  signal: aborter.signal,
  onProgress: (bytesDownloaded, totalBytes) => {
    console.log(`${bytesDownloaded}/${totalBytes}`)
  },
})
```

`onProgress` ticks once per chunk, the run of BGZF blocks the index resolves a
query to. `totalBytes` comes from the index and is known up front.

Notes:

- The scan skips meta/comment lines
- Line strings have no trailing whitespace
- Pass `undefined` for `end` to read to the end of the contig
- A `refName` that is not in the index yields no lines and no error, so a
  `chr1`/`1` naming mismatch looks like an empty region. Check against
  [`getReferenceSequenceNames`](docs/api.md#getreferencesequencenamesopts-promisestring)
  if a query comes back unexpectedly empty
- `start > end` throws a `TypeError`; `start === end` returns without reading

### GAF

tabix-js reads `tabix -p gaf` indexes of sorted GAF (e.g. from `vg gamsort`):

- `refName` is ignored; `getReferenceSequenceNames()` returns `[]`
- `start`/`end` are node ids: a read matches when its lowest-to-highest node
  range `[min, max]` touches any of `start..end-1`, the same reads as
  `tabix file.gaf.gz "{x}:start-end"` (no `+1`)
- The callback gets `min` and `max + 1`
- `getLines` skips reads whose path is a stable sequence name (no `>`/`<`)

### Without NPM (CDN)

```html
<script src="https://unpkg.com/@gmod/tabix/dist/tabix-bundle.js"></script>
```

See [example/index.html](example/index.html) for a demo; serve the directory
(e.g. `npx serve example`) rather than opening the file directly.

## How a query flows

`getLines` looks up a region's BGZF chunks in the index, decompresses each chunk
in wasm, and scans the bytes for matching lines in JS; see
[docs/dataflow.md](docs/dataflow.md).

`TabixIndexedFile` caches decompressed chunks, up to 1GB per file, and drops
them after three idle minutes. A consumer holding one file per track should
bound them together with a shared `chunkCacheBudget` rather than shrinking each
file's ceiling; see [docs/caching.md](docs/caching.md).

## Decompressing on a worker pool

BGZF blocks inflate independently, so a worker pool can spread decompression
across threads.

```typescript
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'

const file = new TabixIndexedFile({
  url: 'https://example.com/yourfile.vcf.gz',
  // the pending promise is fine — it is awaited at the point of use
  bgzfWorkerPool: getSharedWorkerPool(),
})
```

You can pass the pool unconditionally: `getSharedWorkerPool()` returns
`undefined` under node, or anywhere the host forbids Workers, and tabix-js then
decompresses in-process. The pool needs no cross-origin isolation, and tabix-js
never creates one itself, so the consumer controls the thread budget.

On a multi-sample VCF the pool speeds up end-to-end queries by about 1.4x; see
[docs/optimizations.md](docs/optimizations.md) and
[bgzf-filehandle's worker pool docs](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/worker-pool.md).

## Docs

- [docs/api.md](docs/api.md) — every constructor arg and method
- [docs/dataflow.md](docs/dataflow.md) — a query end to end, diagrammed
- [docs/optimizations.md](docs/optimizations.md) — why each step looks the way
  it does
- [docs/caching.md](docs/caching.md) — sizing the decompressed-chunk cache
- [agent-docs/architecture-decision-records/](agent-docs/architecture-decision-records/)
  — the measurements behind those decisions
- [agent-docs/TODO.md](agent-docs/TODO.md) — what is worth doing next
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT
