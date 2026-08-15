# API

## `new TabixIndexedFile(args)`

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

## `getLines(refName, start, end, opts)`

Calls the line callback for each line overlapping `[start, end)`. `start`
defaults to `0` and `end` to the end of the contig when `undefined`. `opts` is
either the callback itself or an object:

| Option         | Type                                                     | Description                             |
| -------------- | -------------------------------------------------------- | --------------------------------------- |
| `lineCallback` | `(line, fileOffset, start, end) => void`                 | Required                                |
| `signal`       | `AbortSignal?`                                           | Aborts the in-flight reads              |
| `onProgress`   | `(bytesDownloaded: number, totalBytes?: number) => void` | Called as compressed blocks are fetched |

## `getHeader(opts?): Promise<string>`

Returns all comment/meta lines before the first data line as a string, matching
what `tabix -H` prints. A header row that is not commented is therefore not
included, even when the index counted it as a line to skip — see
`getSkippedLines`.

## `getHeaderBuffer(opts?): Promise<Uint8Array>`

Returns the header as raw bytes.

## `getSkippedLines(opts?): Promise<string[]>`

Returns the leading lines the index says to skip (`tabix -S N`), or `[]` when it
records none. This is where a file whose header row is not commented keeps it,
which PLINK `.ld`, bedGraph and BED deflines routinely are.

Separate from `getHeader` because htslib treats the two differently: a line is
not data when the index's skip count covers it **or** it starts with the meta
character, but `tabix -H` prints only the latter.

## `getHeaderLines(opts?): Promise<string[]>`

Returns the file's header lines however the file keeps them: the commented block
when there is one, and otherwise the rows the index counted. Empty lines are
dropped.

This is usually the one you want. Reading `getHeader` alone cannot tell a file
that has no header from one whose header is not commented — both come back as
the empty string — so callers fall back to an assumed column layout and quietly
mis-name columns. Both forms are parsed from a single read of the file's leading
blocks, which is also shared with `getHeader` and `getSkippedLines`.

## `getReferenceSequenceNames(opts?): Promise<string[]>`

Returns reference sequence names in index order.

## `lineCount(refName, opts?): Promise<number>`

Returns the number of data lines on the given reference, or `-1` if the
reference is not in the index.

## `bytesForRegions(regions, opts?): Promise<number>`

Estimates the compressed byte size of index chunks covering the given regions.
Useful for deciding whether a request is too large before calling `getLines`.
