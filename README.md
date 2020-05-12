# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
[![Build Status](https://img.shields.io/travis/GMOD/tabix-js/master.svg?style=flat-square)](https://travis-ci.org/GMOD/tabix-js)
[![Greenkeeper badge](https://badges.greenkeeper.io/GMOD/tabix-js.svg)](https://greenkeeper.io/)
[![codecov](https://codecov.io/gh/GMOD/tabix-js/branch/master/graph/badge.svg)](https://codecov.io/gh/GMOD/tabix-js)


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
// also trims chr off the chr names
const csiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  csiPath: 'path/to/my/file.gz.csi'
  renameRefSeqs: (refSeq) => { return refSeq.replace('chr','') }
})

// use a remote file or other filehandle, note RemoteFile comes from https://github.com/GMOD/generic-filehandle
const {RemoteFile} = require('generic-filehandle')
const remoteTbiIndexed = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi') // can also be csiFilehandle
})


// for node.js you have to manually supply a fetch function e.g. node-fetch to RemoteFile
const fetch = require('node-fetch')
const remoteTbiIndexedForNodeJs = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz', {fetch}),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi', {fetch}) // can also be csiFilehandle
})

// iterate over lines in the specified region
const lines = []
await tbiIndexed.getLines('ctgA',200,300, (line, fileOffset) => lines.push(line))
// alternative API usage
const aborter = new AbortController()
await tbiIndexed.getLines('ctgA',200,300, {
  lineCallback: (line, fileOffset) => lines.push(line),
  signal: aborter.signal // an optional AbortSignal from an AbortController
})
// lines is now an array of strings, which are data lines.
// commented (meta) lines are skipped.
// line strings do not include any trailing whitespace characters.
// the callback is also called with a `fileOffset`,
// which gives the virtual file offset where the line is found in the file

// get the approximate number of data lines in the
// file for the given reference sequence, excluding header, comment, and whitespace lines
const numLines = await tbiIndexed.lineCount('ctgA')
// or const numLines = await tbiIndexed.lineCount('ctgA', { signal: aborter.signal })

// get the "header text" string from the file, which is the first contiguous
// set of lines in the file that all start with a "meta" character (usually #)
const headerText = await tbiIndexed.getHeader()
// or const headerText = await tbiIndexed.getHeader({ signal: aborter.signal })

// or if you want a nodejs Buffer object instead, there is getHeaderBuffer()
const headerBuffer = await tbiIndexed.getHeaderBuffer()
// or const headerBuffer = await tbiIndexed.getHeaderBuffer({ signal: aborter.signal })
```

You may also use e.g. `tbiIndexed.getLines('ctgA', 200, undefined, lineCallback)`
to get all lines starting at 200 and going to the end of ctgA.

## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic project that you publish, please cite the most recent JBrowse paper, which will be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
