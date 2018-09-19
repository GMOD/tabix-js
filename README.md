# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
[![Build Status](https://img.shields.io/travis/GMOD/tabix-js/master.svg?style=flat-square)](https://travis-ci.org/GMOD/tabix-js) 

Read Tabix-indexed files using either .tbi or .csi indexes.

## Install

    $ npm install --save @gmod/tabix

## Usage

```js
const {TabixIndexedFile} = require('@gmod/tabix')

const tbiIndexed = new TabixIndexedFile({ path: 'path/to/my/file.gz' })
// by default, assumes tabix index at path/to/my/file.gz.tbi.
// can also provide `tbiPath` if the TBI is named differently

// can also open tabix files that have a .csi index
const csiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  csiPath: 'path/to/my/file.gz.csi'
})

// iterate over lines in the specified region, each of which
// is structured as 
const lines = []
await tbiIndexed.getLines('ctgA',200,300, (line, fileOffset) => lines.push(line))
// lines is now an array of strings, which are data lines.
// commented (meta) lines are skipped.
// line strings do not include any trailing whitespace characters.
// the callback is also called with a `fileOffset`,
// which gives the virtual file offset where the line is found in the file

// get the approximate number of data lines in the
// file for the given reference sequence, excluding header, comment, and whitespace lines
const numLines = await tbiIndexed.lineCount('ctgA')

// get the "header text" string from the file, which is the first contiguous
// set of lines in the file that all start with a "meta" character (usually #)
const headerText = await tbiIndexed.getHeader()

// or if you want a buffer instead, there is getHeaderBuffer()
const headerBuffer = await tbiIndexed.getHeaderBuffer()
```

## License

MIT © [Robert Buels](https://github.com/rbuels)
