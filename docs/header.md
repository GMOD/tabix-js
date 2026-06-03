# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/tabix-js/publish.yml?branch=main)

Read Tabix-indexed files using either .tbi or .csi indexes.

## Install

```bash
npm install @gmod/tabix
```

## Usage

### Importing the module

```typescript
import { TabixIndexedFile } from '@gmod/tabix'
```

### Single file bundle

You can use tabix-js without NPM also with the tabix-bundle.js. See the example
directory for usage with script tag [example/index.html](example/index.html)

```html
<script src="https://unpkg.com/@gmod/tabix/dist/tabix-bundle.js"></script>
```

### TabixIndexedFile constructor

Basic usage of TabixIndexedFile under node.js supplies a path and optionally a
tbiPath to the constructor. If no tbiPath is supplied, it assumes that the
path+'.tbi' is the location of the tbiPath.

```typescript
const tbiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  tbiPath: 'path/to/my/file.gz.tbi',
})
```

You can also use CSI indexes:

```typescript
const csiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  csiPath: 'path/to/my/file.gz.csi',
})
```

#### TabixIndexedFile constructor with remote files

```typescript
const remoteTbiIndexed = new TabixIndexedFile({
  url: 'http://yourhost/file.vcf.gz',
  tbiUrl: 'http://yourhost/file.vcf.gz.tbi', // can also be csiUrl
})
```

You can also supply a filehandle-like object from
[generic-filehandle2](https://github.com/GMOD/generic-filehandle2):

```typescript
import { RemoteFile } from 'generic-filehandle2'

const remoteTbiIndexed = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi'), // can also be csiFilehandle
})
```

### getLines

The basic function this module provides is just called `getLines` and it returns
text contents from the tabix file (it unzips the bgzipped data) and supplies it
to a callback that you provide one line at a time.

Important: the `start` and `end` values that are supplied to `getLines` are
0-based half-open coordinates. This is different from the 1-based values that
are supplied to the tabix command line tool

```typescript
const lines = []
await tbiIndexed.getLines(
  'ctgA',
  200,
  300,
  function (line, fileOffset, start, end) {
    lines.push(line)
  },
)
```

After running this, `lines` contains the matching lines from the file. The
callback receives:

- `line` — the raw line string
- `fileOffset` — virtual file offset, useful as a unique line identifier
- `start` / `end` — the parsed coordinates of that line (0-based half-open)

You can also pass an options object instead of a bare callback:

```typescript
const lines = []
const aborter = new AbortController()
await tbiIndexed.getLines('ctgA', 200, 300, {
  lineCallback: (line, fileOffset, start, end) => lines.push(line),
  signal: aborter.signal, // an optional AbortSignal from an AbortController
})
```

Notes about the returned values of `getLines`:

- commented (meta) lines are skipped.
- line strings do not include any trailing whitespace characters.
- if `getLines` is called with an undefined `end` parameter it gets all lines
  from start going to the end of the contig e.g.

```typescript
const lines = []
await tbiIndexed.getLines('ctgA', 0, undefined, line => lines.push(line))
console.log(lines)
```
