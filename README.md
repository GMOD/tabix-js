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

// Remote files
const remote = new TabixIndexedFile({
  url: 'https://example.com/file.vcf.gz',
  tbiUrl: 'https://example.com/file.vcf.gz.tbi',
})

// Or with a filehandle from generic-filehandle2
import { RemoteFile } from 'generic-filehandle2'

const custom = new TabixIndexedFile({
  filehandle: new RemoteFile('https://example.com/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('https://example.com/file.vcf.gz.tbi'),
})
```

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

`onProgress` ticks once per chunk — the run of BGZF blocks the index resolves a
query to — including instant ticks for chunks already cached, and the index
supplies `totalBytes` up front, which is enough for a determinate progress bar.

Notes:

- The scan skips meta/comment lines
- Line strings have no trailing whitespace
- Pass `undefined` for `end` to read to the end of the contig
- A `refName` that is not in the index yields no lines and no error, so a
  `chr1`/`1` naming mismatch looks like an empty region. Check against
  [`getReferenceSequenceNames`](docs/api.md#getreferencesequencenamesopts-promisestring)
  if a query comes back unexpectedly empty
- `start > end` throws a `TypeError`; `start === end` returns without reading

### Without NPM (CDN)

```html
<script src="https://unpkg.com/@gmod/tabix/dist/tabix-bundle.js"></script>
```

See [example/index.html](example/index.html) for a working demo. It fetches the
VCF over HTTP, so serve the directory (e.g. `npx serve example`) rather than
opening the file directly.

## How a query flows

`getLines` turns a region into BGZF chunks through the index and decompresses
each one in wasm — index reads included, since `.tbi` and `.csi` are bgzipped
too. The rest is ordinary JS: it matches lines as bytes and decodes only the
ones you asked for. [docs/dataflow.md](docs/dataflow.md) has the diagram and
walks it through.

The file then holds on to those decompressed chunks, so overlapping and adjacent
queries reuse them instead of inflating again — up to 1GB per file, dropped
after three idle minutes. A consumer holding one file per track should bound
them together with a shared `chunkCacheBudget` rather than shrinking each file's
own ceiling: [docs/caching.md](docs/caching.md).

## Decompressing on a worker pool

BGZF blocks inflate independently, so that decompression can spread across
threads.

```typescript
import { getSharedWorkerPool } from '@gmod/bgzf-filehandle'

const file = new TabixIndexedFile({
  url: 'https://example.com/yourfile.vcf.gz',
  // the pending promise is fine — it is awaited at the point of use
  bgzfWorkerPool: getSharedWorkerPool(),
})
```

Safe to pass unconditionally: `getSharedWorkerPool()` returns `undefined` under
node, or anywhere the host forbids Workers, which keeps the in-process path. No
cross-origin isolation needed. tabix-js never creates a pool on its own — the
thread budget belongs to the consumer.

Expect a smaller multiple than a BAM reader reports. The blocks come back
separately and are concatenated on the calling thread, which no worker count
speeds up and which scales with the _decompressed_ size — and text compresses
hard, so on a bgzipped GFF that concat is 58% of the call and the end-to-end
figure is flat at ~1.0x while the inflate alone is 2.49x. Worth passing, since
it costs nothing where it does not help; not worth planning around unmeasured.
Worker counts, lifecycle and benchmarks:
[bgzf-filehandle's worker pool docs](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/worker-pool.md).

## Docs

- [docs/api.md](docs/api.md) — every constructor arg and method
- [docs/dataflow.md](docs/dataflow.md) — a query end to end, diagrammed
- [docs/optimizations.md](docs/optimizations.md) — why each step of that path
  looks the way it does, and what measured it
- [docs/caching.md](docs/caching.md) — sizing the decompressed-chunk cache, and
  bounding many files together
- [agent-docs/adr/](agent-docs/adr/) — the measurements behind those decisions
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic Use

Written with [NHGRI](http://genome.gov) funding as part of
[JBrowse](http://jbrowse.org). If you use this in a publication, please cite the
most recent JBrowse paper at [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
