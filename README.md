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

Over HTTP, pass a filehandle from
[`@gmod/range-cache-filehandle`](https://github.com/GMOD/range-cache-filehandle),
which merges the scattered block reads of a query into a few requests:

- A query fetches the index once, then reads each BGZF block that the index
  points to as a separate byte range. The cache reads in 256 KiB chunks, so
  neighboring blocks share one request.
- Because overlapping queries re-read the same blocks, twenty half-overlapping
  windows panned across the 3.4 MB test BED file read 11 MB without the cache,
  and with the cache tabix-js fetches each byte once.

A bare `url` uses `RemoteFile` from generic-filehandle2, which sends one request
per read and caches nothing.

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
query to.

- Chunks already cached tick instantly.
- `totalBytes` comes from the index and is known up front, enough to draw a
  determinate progress bar.

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

See [example/index.html](example/index.html) for a working demo. It fetches the
VCF over HTTP, so serve the directory (e.g. `npx serve example`) rather than
opening the file directly.

## How a query flows

`getLines` looks up a region's BGZF chunks in the index and decompresses each
chunk in wasm. Index reads go through wasm too, since `.tbi` and `.csi` are
bgzipped. The code after decompression is ordinary JS, which matches lines as
bytes and decodes only the ones you asked for.
[docs/dataflow.md](docs/dataflow.md) has the diagram.

`TabixIndexedFile` keeps decompressed chunks, so overlapping and adjacent
queries skip inflating them again.

- The cache holds up to 1GB per file and drops chunks after three idle minutes.
- A consumer holding one file per track should bound them together with a shared
  `chunkCacheBudget` rather than shrinking each file's ceiling. See
  [docs/caching.md](docs/caching.md).

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

You can pass the pool unconditionally:

- `getSharedWorkerPool()` returns `undefined` under node, or anywhere the host
  forbids Workers, and tabix-js then decompresses in-process.
- The pool needs no cross-origin isolation.
- tabix-js never creates a pool on its own, so the consumer controls the thread
  budget.

On a multi-sample VCF the pool speeds up end-to-end queries by about 1.4x.
Per-line byte scanning and string decoding limit that speedup, not
decompression.

Worker counts, lifecycle and benchmarks are in
[bgzf-filehandle's worker pool docs](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/worker-pool.md).
The end-to-end numbers, and how to confirm a pool engages in production, are in
jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md).

## Docs

- [docs/api.md](docs/api.md) — every constructor arg and method
- [docs/dataflow.md](docs/dataflow.md) — a query end to end, diagrammed
- [docs/optimizations.md](docs/optimizations.md) — why each step of that path
  looks the way it does, and what measured it
- [docs/caching.md](docs/caching.md) — sizing the decompressed-chunk cache, and
  bounding many files together
- [agent-docs/architecture-decision-records/](agent-docs/architecture-decision-records/)
  — the measurements behind those decisions
- [agent-docs/TODO.md](agent-docs/TODO.md) — what is worth doing next, and what
  has to be measured before it
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT
