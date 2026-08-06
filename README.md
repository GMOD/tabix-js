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

`onProgress` ticks once per compressed block, including instant ticks for cache
hits, and `totalBytes` is known up front from the index — enough for a
determinate progress bar.

Notes:

- Meta/comment lines are skipped
- Line strings have no trailing whitespace
- Pass `undefined` for `end` to read to the end of the contig
- A `refName` that is not in the index yields no lines and no error, so a
  `chr1`/`1` naming mismatch looks like an empty region. Check against
  [`getReferenceSequenceNames`](#getreferencesequencenamesopts-promisestring) if
  a query comes back unexpectedly empty
- `start > end` throws a `TypeError`; `start === end` returns without reading

### Without NPM (CDN)

```html
<script src="https://unpkg.com/@gmod/tabix/dist/tabix-bundle.js"></script>
```

See [example/index.html](example/index.html) for a working demo. It fetches the
VCF over HTTP, so serve the directory (e.g. `npx serve example`) rather than
opening the file directly.

## API

### `new TabixIndexedFile(args)`

| Arg                       | Type                 | Description                                                                                                                                                                                                                                   |
| ------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                    | `string?`            | Local file path                                                                                                                                                                                                                               |
| `url`                     | `string?`            | Remote URL                                                                                                                                                                                                                                    |
| `filehandle`              | `GenericFilehandle?` | Custom filehandle (from [generic-filehandle2](https://github.com/GMOD/generic-filehandle2))                                                                                                                                                   |
| `tbiPath`                 | `string?`            | TBI index path (defaults to `path + '.tbi'`)                                                                                                                                                                                                  |
| `tbiUrl`                  | `string?`            | TBI index URL                                                                                                                                                                                                                                 |
| `tbiFilehandle`           | `GenericFilehandle?` | TBI index filehandle                                                                                                                                                                                                                          |
| `csiPath`                 | `string?`            | CSI index path                                                                                                                                                                                                                                |
| `csiUrl`                  | `string?`            | CSI index URL                                                                                                                                                                                                                                 |
| `csiFilehandle`           | `GenericFilehandle?` | CSI index filehandle                                                                                                                                                                                                                          |
| `chunkCacheSize`          | `number?`            | Chunk LRU cache budget, in _decompressed_ bytes (default 1 GiB). A retention bound, not a bound on peak memory. Size it to hold several queries: below one query's working set the hit rate drops to zero while the memory is retained anyway |
| `chunkCacheIdleTimeoutMs` | `number?`            | Drop a cached chunk once nothing has read it for this long (default 3 minutes, `0` disables). The only thing that lowers the cache while nothing is happening, and what makes the budget above a peak rather than a resting level             |

### `getLines(refName, start, end, opts)`

Calls the line callback for each line overlapping `[start, end)`. `start`
defaults to `0` and `end` to the end of the contig when `undefined`. `opts` is
either the callback itself or an object:

| Option         | Type                                                     | Description                             |
| -------------- | -------------------------------------------------------- | --------------------------------------- |
| `lineCallback` | `(line, fileOffset, start, end) => void`                 | Required                                |
| `signal`       | `AbortSignal?`                                           | Aborts the in-flight reads              |
| `onProgress`   | `(bytesDownloaded: number, totalBytes?: number) => void` | Called as compressed blocks are fetched |

### `getHeader(opts?): Promise<string>`

Returns all comment/meta lines before the first data line as a string, matching
what `tabix -H` prints. A header row that is not commented is therefore not
included, even when the index counted it as a line to skip — see
`getSkippedLines`.

### `getHeaderBuffer(opts?): Promise<Uint8Array>`

Returns the header as raw bytes.

### `getSkippedLines(opts?): Promise<string[]>`

Returns the leading lines the index says to skip (`tabix -S N`), or `[]` when it
records none. This is where a file whose header row is not commented keeps it,
which PLINK `.ld`, bedGraph and BED deflines routinely are.

Separate from `getHeader` because htslib treats the two differently: a line is
not data when the index's skip count covers it **or** it starts with the meta
character, but `tabix -H` prints only the latter.

### `getHeaderLines(opts?): Promise<string[]>`

Returns the file's header lines however the file keeps them: the commented block
when there is one, and otherwise the rows the index counted. Empty lines are
dropped.

This is usually the one you want. Reading `getHeader` alone cannot tell a file
that has no header from one whose header is not commented — both come back as
the empty string — so callers fall back to an assumed column layout and quietly
mis-name columns. Both forms are parsed from a single read of the file's leading
blocks, which is also shared with `getHeader` and `getSkippedLines`.

### `getReferenceSequenceNames(opts?): Promise<string[]>`

Returns reference sequence names in index order.

### `lineCount(refName, opts?): Promise<number>`

Returns the number of data lines on the given reference, or `-1` if the
reference is not in the index.

### `bytesForRegions(regions, opts?): Promise<number>`

Estimates the compressed byte size of index chunks covering the given regions.
Useful for deciding whether a request is too large before calling `getLines`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and release steps.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
