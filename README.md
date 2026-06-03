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
const file = new TabixIndexedFile({
  path: 'file.vcf.gz',
  csiPath: 'file.vcf.gz.csi',
})

// Remote files
const file = new TabixIndexedFile({
  url: 'https://example.com/file.vcf.gz',
  tbiUrl: 'https://example.com/file.vcf.gz.tbi',
})

// Or with a filehandle from generic-filehandle2
import { RemoteFile } from 'generic-filehandle2'

const file = new TabixIndexedFile({
  filehandle: new RemoteFile('https://example.com/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('https://example.com/file.vcf.gz.tbi'),
})
```

### getLines

Fetches lines overlapping a region. `start`/`end` are 0-based half-open coordinates (unlike the tabix CLI which uses 1-based closed).

```typescript
const lines: string[] = []
await file.getLines('chr1', 200, 300, line => lines.push(line))
```

The callback also receives the virtual file offset and parsed coordinates for the line:

```typescript
await file.getLines('chr1', 200, 300, (line, fileOffset, start, end) => {
  lines.push(line)
})
```

Pass an options object to use an `AbortSignal`:

```typescript
const aborter = new AbortController()
await file.getLines('chr1', 200, 300, {
  lineCallback: (line, fileOffset, start, end) => lines.push(line),
  signal: aborter.signal,
})
```

Notes:
- Meta/comment lines are skipped
- Line strings have no trailing whitespace
- Pass `undefined` for `end` to read to the end of the contig

### Without NPM (CDN)

```html
<script src="https://unpkg.com/@gmod/tabix/dist/tabix-bundle.js"></script>
```

See [example/index.html](example/index.html) for a working demo.

## API

### `new TabixIndexedFile(args)`

| Arg | Type | Description |
| --- | --- | --- |
| `path` | `string?` | Local file path |
| `url` | `string?` | Remote URL |
| `filehandle` | `GenericFilehandle?` | Custom filehandle (from [generic-filehandle2](https://github.com/GMOD/generic-filehandle2)) |
| `tbiPath` | `string?` | TBI index path (defaults to `path + '.tbi'`) |
| `tbiUrl` | `string?` | TBI index URL |
| `tbiFilehandle` | `GenericFilehandle?` | TBI index filehandle |
| `csiPath` | `string?` | CSI index path |
| `csiUrl` | `string?` | CSI index URL |
| `csiFilehandle` | `GenericFilehandle?` | CSI index filehandle |
| `chunkCacheSize` | `number?` | Chunk LRU cache size in bytes (default 5 MiB) |

### `getLines(refName, start, end, opts)`

Calls `opts` (or `opts.lineCallback`) for each line overlapping `[start, end)`.

Callback signature: `(line: string, fileOffset: number, start: number, end: number) => void`

### `getHeader(opts?): Promise<string>`

Returns all comment/meta lines before the first data line as a string.

### `getHeaderBuffer(opts?): Promise<Uint8Array>`

Returns the header as raw bytes.

### `getReferenceSequenceNames(opts?): Promise<string[]>`

Returns reference sequence names in index order. `renameRefSeqs` is not applied to these names.

### `lineCount(refName, opts?): Promise<number>`

Returns the number of data lines on the given reference, or `-1` if the reference is not in the index.

### `bytesForRegions(regions, opts?): Promise<number>`

Estimates the compressed byte size of index chunks covering the given regions. Useful for deciding whether a request is too large before calling `getLines`.

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub Actions.

```bash
pnpm version patch  # or minor/major
```

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic project that you publish, please cite the most recent JBrowse paper, which will be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
