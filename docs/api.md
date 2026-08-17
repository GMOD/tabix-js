# API

## `new TabixIndexedFile(args)`

| Arg                       | Type                 | Description                                                                                                                                                                                                                                       |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                    | `string?`            | Local file path                                                                                                                                                                                                                                   |
| `url`                     | `string?`            | Remote URL                                                                                                                                                                                                                                        |
| `filehandle`              | `GenericFilehandle?` | Custom filehandle (from [generic-filehandle2](https://github.com/GMOD/generic-filehandle2))                                                                                                                                                       |
| `tbiPath`                 | `string?`            | TBI index path (defaults to `path + '.tbi'`)                                                                                                                                                                                                      |
| `tbiUrl`                  | `string?`            | TBI index URL                                                                                                                                                                                                                                     |
| `tbiFilehandle`           | `GenericFilehandle?` | TBI index filehandle                                                                                                                                                                                                                              |
| `csiPath`                 | `string?`            | CSI index path                                                                                                                                                                                                                                    |
| `csiUrl`                  | `string?`            | CSI index URL                                                                                                                                                                                                                                     |
| `csiFilehandle`           | `GenericFilehandle?` | CSI index filehandle                                                                                                                                                                                                                              |
| `chunkCacheSize`          | `number?`            | Chunk LRU cache budget, in _decompressed_ bytes (default 1 GiB). A retention bound, not a bound on peak memory. Size it to hold several queries: below one query's working set the hit rate drops to zero while the cache holds the memory anyway |
| `chunkCacheIdleTimeoutMs` | `number?`            | Drop a cached chunk once nothing has read it for this long (default 3 minutes, `0` disables). The only thing that lowers the cache while nothing is happening, making the budget above a peak rather than a resting level                         |
| `chunkCacheBudget`        | `SharedBudget?`      | A `@gmod/shared-read-cache` budget shared with other files, so the ceiling applies to their sum rather than to each — see [caching.md](caching.md#chunkcachebudget-is-what-bounds-a-consumer-with-many-files)                                     |
| `bgzfWorkerPool`          | `BgzfWorkerPool?`    | A `@gmod/bgzf-filehandle` pool to inflate this file's chunks on. Accepts the promise `getSharedWorkerPool()` returns, and `undefined` keeps the in-process path — see [the README](../README.md#decompressing-on-a-worker-pool)                   |

Every method taking `opts?` takes `signal` and `onProgress`, the latter
reporting the `.tbi`/`.csi` download when that call is what triggers it — a
whole-file read, so it streams real byte progress rather than chunk steps.

## `clearChunkCache()`

Drops every decompressed chunk this file holds, and stops the idle sweep until
something is cached again. For a consumer that knows it is finished with a file
— a closed track — where `chunkCacheIdleTimeoutMs` is for one the user has
merely wandered away from.

## `getLines(refName, start, end, opts)`

Calls the line callback for each line overlapping `[start, end)`. `start`
defaults to `0` and `end` to the end of the contig when `undefined`. `opts` is
either the callback itself or an object:

| Option         | Type                                                     | Description                 |
| -------------- | -------------------------------------------------------- | --------------------------- |
| `lineCallback` | `(line, fileOffset, start, end) => void`                 | Required                    |
| `signal`       | `AbortSignal?`                                           | Aborts the in-flight reads  |
| `onProgress`   | `(bytesDownloaded: number, totalBytes?: number) => void` | Fires as each chunk arrives |

## `getHeader(opts?): Promise<string>`

All comment/meta lines before the first data line, as a string, matching what
`tabix -H` prints. An uncommented header row therefore stays out, even when the
index counted it as a line to skip — see `getSkippedLines`.

## `getHeaderBuffer(opts?): Promise<Uint8Array>`

The header as raw bytes.

## `getSkippedLines(opts?): Promise<string[]>`

The leading lines the index says to skip (`tabix -S N`), or `[]` when it records
none. This is where a file with an uncommented header row keeps it, as PLINK
`.ld`, bedGraph and BED deflines routinely do.

Separate from `getHeader` because htslib treats the two differently: a line is
not data when the index's skip count covers it **or** it starts with the meta
character, but `tabix -H` prints only the latter.

## `getHeaderLines(opts?): Promise<string[]>`

The file's header lines however the file keeps them: the commented block when
there is one, otherwise the rows the index counted, dropping empty lines.

Usually the one you want. `getHeader` alone cannot tell a file that has no
header from one whose header is not commented — both come back as the empty
string — so callers fall back to an assumed column layout and quietly mis-name
columns. A single read of the leading blocks yields both forms, shared with
`getHeader` and `getSkippedLines`.

## `getReferenceSequenceNames(opts?): Promise<string[]>`

Reference sequence names, in index order.

## `lineCount(refName, opts?): Promise<number>`

Number of data lines on the given reference, or `-1` if it is not in the index.

## `bytesForRegions(regions, opts?): Promise<number>`

Estimated compressed size of the index chunks covering the given regions — an
upper bound, for gating a request before calling `getLines`.
