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

<img src="docs/dataflow.svg" alt="tabix-js data flow" width="700">

Orange is wasm, and it is only ever inflate — every index read included, since
`.tbi` and `.csi` are both bgzipped. Lines are matched as bytes and decoded only
if they match.

## Docs

- [docs/api.md](docs/api.md) — every constructor arg and method
- [docs/dataflow.md](docs/dataflow.md) — the diagram above, walked through
- [OPTIMIZATIONS.md](OPTIMIZATIONS.md) — why each step of that path looks the
  way it does, and what measured it
- [agent-docs/adr/](agent-docs/adr/) — the measurements behind those decisions
- [CONTRIBUTING.md](CONTRIBUTING.md) — development and release steps

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
