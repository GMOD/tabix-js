# @gmod/tabix

[![NPM version](https://img.shields.io/npm/v/@gmod/tabix.svg?style=flat-square)](https://npmjs.org/package/@gmod/tabix)
[![Build Status](https://img.shields.io/travis/GMOD/tabix-js/master.svg?style=flat-square)](https://travis-ci.org/GMOD/tabix-js)
[![codecov](https://codecov.io/gh/GMOD/tabix-js/branch/master/graph/badge.svg)](https://codecov.io/gh/GMOD/tabix-js)


Read Tabix-indexed files using either .tbi or .csi indexes.

## Install

    $ npm install --save @gmod/tabix

## Usage


### Importing the module

```js

// import with require in node.js
const {TabixIndexedFile} = require('@gmod/tabix')

// or with es6 imports, this will also give typescript types
import {TabixIndexedFile} from '@gmod/tabix'
```


### TabixIndexedFile constructor


Basic usage of TabixIndexedFile under node.js supplies a path and optionally a tbiPath to the constructor. If no tbiPath is supplied, it assumes that the path+'.tbi' is the location of the tbiPath.

```
// basic usage under node.js provides a file path on the filesystem to bgzipped file
// it assumes the tbi file is path+'.tbi' if no tbiPath is supplied
const tbiIndexed = new TabixIndexedFile({
    path: 'path/to/my/file.gz'
    tbiPath: 'path/to/my/file.gz.tbi'
})

```

You can also use CSI indexes. Note also the usage of the renameRefSeqs callback. The renameRefSeqs callback makes it so that you can use file.getLines('1',0,100,...) even when the file itself contains names like 'chr1' (can also do the reverse by customizing the renameRefSeqs callback)

```
// can also open tabix files that have a .csi index
// note also usage of renameRefSeqs callback to trim chr off the chr names
const csiIndexed = new TabixIndexedFile({
  path: 'path/to/my/file.gz',
  csiPath: 'path/to/my/file.gz.csi'
  renameRefSeqs: refSeq => refSeq.replace('chr','')
})
```

#### TabixIndexedFile constructor with remote files


The basic usage of fetching remote files is done by supplying a [generic-filehandle](https://github.com/GMOD/generic-filehandle) module RemoteFile filehandle, as seen below


```
// use a remote file or other filehandle, note RemoteFile comes from https://github.com/GMOD/generic-filehandle
const {RemoteFile} = require('generic-filehandle')
const remoteTbiIndexed = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz'),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi') // can also be csiFilehandle
})
```


This works in both the browser and in node.js, but note that in node.js you have to also supply a custom fetch function to the RemoteFile constructor e.g. like this


```
// for node.js you have to manually supply a fetch function e.g. node-fetch to RemoteFile
const fetch = require('node-fetch')
const remoteTbiIndexedForNodeJs = new TabixIndexedFile({
  filehandle: new RemoteFile('http://yourhost/file.vcf.gz', {fetch}),
  tbiFilehandle: new RemoteFile('http://yourhost/file.vcf.gz.tbi', {fetch}) // can also be csiFilehandle
})
```


### getLines


The basic function this module provides is just called `getLines` and it returns text contents from the tabix file (it unzips the bgzipped data) and supplies it to a callback that you provide one line at a time.


Important: the `start` and `end` values that are supplied to `getLines` are 0-based half-open coordinates. This is different from the 1-based values that are supplied to the tabix command line tool


```
// iterate over lines in the specified region
const lines = []
await tbiIndexed.getLines('ctgA',200,300, function(line, fileOffset) {
    lines.push(line)
})

```

After running this, your `lines` array would contain an array of lines from the file that match your query range


You can also supply some extra arguments to getLines with this format, but these are sort of obscure and only used in some circumstances


```
const lines = []
const aborter = new AbortController()
await tbiIndexed.getLines('ctgA',200,300, {
  lineCallback: (line, fileOffset) => lines.push(line),
  signal: aborter.signal // an optional AbortSignal from an AbortController
})

```

After running the above demo, lines is now an array of strings, containing the lines from the tabix file

Notes about the returned values of `getLines`:

- commented (meta) lines are skipped.
- line strings do not include any trailing whitespace characters.
- the callback is also called with a `fileOffset` that can be used to uniquely identify lines based on their virtual file offset where the line is found in the file
- if getLines is called with an undefined `end` parameter it gets all lines from start going to the end of the contig e.g.

```
const lines = []
await tbiIndexed.getLines('ctgA', 0, undefined, line=>lines.push(line))`
console.log(lines)
```




### lineCount


```
// get the approximate number of data lines in the
// file for the given reference sequence, excluding header, comment, and whitespace lines
// uses the extra bin from tabix
const numLines = await tbiIndexed.lineCount('ctgA')
// or const numLines = await tbiIndexed.lineCount('ctgA', { signal: aborter.signal })

```


### getHeader

```
// get the "header text" string from the file, which is the first contiguous
// set of lines in the file that all start with a "meta" character (usually #)
const headerText = await tbiIndexed.getHeader()
// or const headerText = await tbiIndexed.getHeader({ signal: aborter.signal })
```

#### getHeaderBuffer

```
// or if you want a nodejs Buffer object instead, there is getHeaderBuffer()
const headerBuffer = await tbiIndexed.getHeaderBuffer()
// or const headerBuffer = await tbiIndexed.getHeaderBuffer({ signal: aborter.signal })
```


## Academic Use

This package was written with funding from the [NHGRI](http://genome.gov) as part of the [JBrowse](http://jbrowse.org) project. If you use it in an academic project that you publish, please cite the most recent JBrowse paper, which will be linked from [jbrowse.org](http://jbrowse.org).

## License

MIT © [Robert Buels](https://github.com/rbuels)
