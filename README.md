# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
[![Coverage Status](https://img.shields.io/codecov/c/github/GMOD/tabix-js/master.svg?style=flat-square)](https://codecov.io/gh/GMOD/tabix-js/branch/master)
[![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/tabix-js/push.yml?branch=master)](https://github.com/GMOD/tabix-js/actions)

Read Tabix-indexed files using either .tbi or .csi indexes.

## Install

    $ npm install --save @gmod/tabix

## Usage

### Importing the module

```typescript
// import with require in node.js
const { TabixIndexedFile } = require('@gmod/tabix')

// or with es6 imports, this will also give typescript types
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
// basic usage under node.js provides a file path on the filesystem to bgzipped file
// it assumes the tbi file is path+'.tbi' if no tbiPath is supplied
const tbiIndexed = new TabixIndexedFile({
    path: 'path/to/my/file.gz'
    tbiPath: 'path/to/my/file.gz.tbi'
})

```

You can also use CSI indexes. Note also the usage of the `renameRefSeqs`
callback. The `renameRefSeqs` callback makes it so that you can use
`file.getLines('1',0,100,...)` even when the file itself contains names like
'chr1' (can also do the reverse by customizing the `renameRefSeqs` callback)

```typescript
// can also open tabix files that have a .csi index
// note also usage of renameRefSeqs callback to trim chr off the chr names
const csiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  csiPath: 'path/to/my/file.gz.csi'
  renameRefSeqs: refSeq => refSeq.replace('chr','')
})
```

#### TabixIndexedFile constructor with remote files

```typescript
const remoteTbiIndexed = new TabixIndexedFile({
  url: 'http://yourhost/file.vcf.gz',
  tbiUrl: 'http://yourhost/file.vcf.gz.tbi', // can also be csiUrl
})
```

You can also alternatively supply a filehandle-like object with the
[generic-filehandle](https://github.com/GMOD/generic-filehandle): example

```typescript
// use a remote file or other filehandle, note RemoteFile comes from https://github.com/GMOD/generic-filehandle
const { RemoteFile } = require('generic-filehandle')
const remoteTbiIndexed = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi'), // can also be csiFilehandle
})
```

This works in both the browser and in node.js, but note that in node.js you may
have to also supply a custom fetch function to the RemoteFile constructor e.g.
like this

```typescript
// for node.js you have to manually supply a fetch function e.g. node-fetch to RemoteFile
const fetch = require('node-fetch')
const remoteTbiIndexedForNodeJs = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz', { fetch }),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi', { fetch }), // can also be csiFilehandle
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
// iterate over lines in the specified region
const lines = []
await tbiIndexed.getLines('ctgA', 200, 300, function (line, fileOffset) {
  lines.push(line)
})
```

After running this, your `lines` array would contain an array of lines from the
file that match your query range

You can also supply some extra arguments to `getLines` with this format, but
these are sort of obscure and only used in some circumstances

```typescript
const lines = []
const aborter = new AbortController()
await tbiIndexed.getLines('ctgA', 200, 300, {
  lineCallback: (line, fileOffset) => lines.push(line),
  signal: aborter.signal, // an optional AbortSignal from an AbortController
})
```

After running the above demo, lines is now an array of strings, containing the
lines from the tabix file

Notes about the returned values of `getLines`:

- commented (meta) lines are skipped.
- line strings do not include any trailing whitespace characters.
- the callback is also called with a `fileOffset` that can be used to uniquely
  identify lines based on their virtual file offset where the line is found in
  the file
- if `getLines` is called with an undefined `end` parameter it gets all lines
  from start going to the end of the contig e.g.

```typescript
const lines = []
await tbiIndexed.getLines('ctgA', 0, undefined, line=>lines.push(line))`
console.log(lines)
```

## API (auto-generated)

### TabixIndexedFile

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

##### Table of Contents

- [constructor](#constructor)
  - [Parameters](#parameters)
- [getLines](#getlines)
  - [Parameters](#parameters-1)
- [getHeaderBuffer](#getheaderbuffer)
  - [Parameters](#parameters-2)
- [getHeader](#getheader)
  - [Parameters](#parameters-3)
- [getReferenceSequenceNames](#getreferencesequencenames)
  - [Parameters](#parameters-4)
- [checkLine](#checkline)
  - [Parameters](#parameters-5)
- [lineCount](#linecount)
  - [Parameters](#parameters-6)
- [readChunk](#readchunk)
  - [Parameters](#parameters-7)

#### constructor

##### Parameters

- `args`
  **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

  - `args.path`
    **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?**&#x20;
  - `args.filehandle` **filehandle?**&#x20;
  - `args.url`
    **[url](https://developer.mozilla.org/docs/Web/API/URL/URL)?**&#x20;
  - `args.tbiPath`
    **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?**&#x20;
  - `args.tbiUrl` **tbiUrl?**&#x20;
  - `args.tbiFilehandle` **filehandle?**&#x20;
  - `args.csiPath`
    **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)?**&#x20;
  - `args.csiUrl` **csiUrl?**&#x20;
  - `args.csiFilehandle` **filehandle?**&#x20;
  - `args.yieldTime`
    **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?**
    yield to main thread after N milliseconds if reading features is taking a
    long time to avoid hanging main thread (optional, default `500`)
  - `args.renameRefSeqs`
    **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)?**
    optional function with sig `string => string` to transform reference
    sequence names for the purpose of indexing and querying. note that the data
    that is returned is not altered, just the names of the reference sequences
    that are used for querying. (optional, default `n=>n`)
  - `args.chunkCacheSize` (optional, default `5*2**20`)

#### getLines

##### Parameters

- `refName`
  **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)**
  name of the reference sequence
- `s`
  **([number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)
  |
  [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))**&#x20;
- `e`
  **([number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)
  |
  [undefined](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/undefined))**&#x20;
- `opts` **(GetLinesOpts | GetLinesCallback)** callback called for each line in
  the region. can also pass a object param containing obj.lineCallback,
  obj.signal, etc
- `start` start of the region (in 0-based half-open coordinates)
- `end` end of the region (in 0-based half-open coordinates)

Returns **any** promise that is resolved when the whole read is finished,
rejected on error

#### getHeaderBuffer

get a buffer containing the "header" region of the file, which are the bytes up
to the first non-meta line

##### Parameters

- `opts` **Options** (optional, default `{}`)

#### getHeader

get a string containing the "header" region of the file, is the portion up to
the first non-meta line

##### Parameters

- `opts` **Options** (optional, default `{}`)

Returns
**[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)**
for a string

#### getReferenceSequenceNames

get an array of reference sequence names, in the order in which they occur in
the file. reference sequence renaming is not applied to these names.

##### Parameters

- `opts` **Options** (optional, default `{}`)

#### checkLine

##### Parameters

- `metadata`
  **[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**
  metadata object from the parsed index, containing columnNumbers, metaChar, and
  format
- `regionRefName`
  **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)**&#x20;
- `regionStart`
  **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**
  region start coordinate (0-based-half-open)
- `regionEnd`
  **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)**
  region end coordinate (0-based-half-open)
- `line`
  **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)**&#x20;

Returns
**[object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**
like `{startCoordinate, overlaps}`. overlaps is boolean, true if line is a data
line that overlaps the given region

#### lineCount

return the approximate number of data lines in the given reference sequence

##### Parameters

- `refName`
  **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)**&#x20;
- `opts` **Options** (optional, default `{}`)
- `refSeq` reference sequence name

Returns **any** number of data lines present on that reference sequence

#### readChunk

read and uncompress the data in a chunk (composed of one or more contiguous
bgzip blocks) of the file

##### Parameters

- `c` **Chunk**&#x20;
- `opts` **Options** (optional, default `{}`)

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as
part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic
project that you publish, please cite the most recent JBrowse paper, which will
be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
