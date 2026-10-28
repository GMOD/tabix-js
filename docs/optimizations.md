# Optimizations

Two things dominate a query: network round trips, and inflating more bytes than
the answer needs. [dataflow.md](dataflow.md) draws the path itself.

## Reading the index

### Parsed once, shared across callers

The first query reads the whole `.tbi`/`.csi`, inflates it, parses it, and
memoizes the result for the life of the object.

The parse is shared as well as memoized. It runs under a separate abort signal
and aborts only once every caller waiting on it has given up, so a query that
pans away can't abort the index read that concurrent queries depend on.
`getIndices(refId)` is separately LRU-memoized so repeated lookups don't re-walk
the parsed bytes.

### One allocation for the linear-index scan

The index parse visits every linear-index entry in the file to find the minimum
virtual offset: 301k of them on `test/data/failing_tabix.vcf.gz.tbi`, against
19k bin chunks. `minVirtualOffset` therefore compares packed offsets in place
and allocates at most one `VirtualOffset` instead of one per entry.

## Choosing and fetching chunks

### Prune, merge and clamp before fetching anything

`blocksForRange` collects a chunk per overlapping bin at every level, far more
than a query reads. Before any I/O, `optimizeChunks`:

- drops chunks ending at or before the linear-index floor, _before_ sorting;
- merges neighbours within 65KB (up to a 5MB span), so adjacent bins become one
  range request;
- trims overlaps, so no fetch covers the same byte twice.

`clampChunkEnds` then pulls each chunk's end down to the next known BGZF block
boundary rather than over-reading a full maximum-size block. The fetches and the
`bytesForRegions` estimate both shrink, with no extra I/O.

### Drop merged chunks that start past the query

The linear index bounds a query from below only. `blocksForRange` also bounds it
from above, as htslib's `hts_itr_query` does. The first chunk of the first bin
to the right of the query starts with a record past the query end, and in a
sorted file every later record is past it too, so `blocksForRange` drops every
merged chunk starting at or past that offset (`max_off`). The bound comes from
the bins alone, so unlike the linear index it still works on a GFF whose first
record spans the chromosome.

Over 3,283 cold windows across every fixture, as TBI and as CSI, requests fall
17% and every window returns the same lines at the same offsets. The GFF
fixtures gain most: a third fewer requests and 13% fewer bytes. In `@gmod/bam`'s
[ADR 0023](https://github.com/GMOD/bam-js/blob/main/agent-docs/architecture-decision-records/0023-drop-merged-chunks-past-max-off.md),
bam-js measured why it drops whole chunks after the merge rather than trimming
them or dropping them before the merge. The merged chunk is the cache key, and
cutting it at a point that moves with the query end made pans read up to 79%
more.

### Start the first chunk at the floor of its 128kb window

`optimizeChunks` drops a chunk that ends below the linear-index floor and keeps
one that straddles it. htslib reads a straddling chunk from the floor of the
query's 16kb window (`min_off` in `hts_itr_query`). `blocksForRange` moves its
start up to the floor of the eight leaf windows holding the query start: 128kb
in TBI, and the `loffset` walk in CSI.

- **Where it helps:** htslib folds every bin under 64KB compressed into its
  parent, so in a file of moderate density one chunk covers a whole 1Mb bin, and
  without the clamp every query reads all of it. `test/data/folded_bins.bed.gz`
  has such a bin. The other fixtures have none, and the clamp changed no chunk
  in about a thousand windows over them.
- **What it saves**, as median bytes over 50 cold 10kb windows on a 20Mb
  pangenome graph's BEDs from gfa-to-tabix, one read each:

  | file                    | before  | after   | htslib `tabix` |
  | ----------------------- | ------- | ------- | -------------- |
  | segments                | 118.8KB | 59.7KB  | 12.3KB         |
  | links                   | 204.7KB | 104.4KB | 10.9KB         |
  | segments, megabase rows | 1,490KB | 1,490KB | 724KB          |

  Megabase-long rows pin the floor near the start of the file, for htslib too.
  The rest of the gap to htslib lies past the query, because we fetch a chunk to
  its end and htslib stops reading at the first record past the query.

- **Why 128kb and not htslib's 16kb:** the merged chunk is the cache key, and
  the 16kb floor changes it at every 16kb of a pan. Bytes over a warm pan of 40
  10kb windows stepping 5kb, from five starts:

  | file                    | before  | 16kb floor | 128kb floor |
  | ----------------------- | ------- | ---------- | ----------- |
  | segments                | 597KB   | 3,722KB    | 635KB       |
  | links                   | 1,038KB | 6,315KB    | 1,094KB     |
  | segments, megabase rows | 9,329KB | 11,017KB   | 11,017KB    |

  Those pans ran before a chunk could read from a cached chunk containing it
  ([below](#a-chunk-inside-a-cached-one-reads-from-it)). With that reuse, a pan
  that crosses a 128kb edge reads its later start from the chunk it already
  holds. On real files, median cold bytes over 60 windows and bytes over five
  warm pans:

  | file                | main, cold | clamp, cold | main, pan | reuse + clamp, pan |
  | ------------------- | ---------- | ----------- | --------- | ------------------ |
  | hg38 GFF3, chr1     | 97.4KB     | 82.7KB      | 362KB     | 286KB              |
  | HPRC MC links, chr1 | 142.6KB    | 117.7KB     | 736KB     | 435KB              |
  | NA12878 VCF, chr1   | 11.6KB     | 11.6KB      | 927KB     | 510KB              |
  | C. elegans chrI BED | 165.4KB    | 165.4KB     | 4,893KB   | 2,795KB            |

- **Risk:** the clamp trusts a linear-index entry to skip records inside a
  chunk, where the drop trusts it only to discard whole chunks. An index whose
  entry lies past a record overlapping its window would lose that record. htslib
  trusts the same entries at a finer grain, and the clamp never passes the entry
  for the query's own 16kb window. Tabix 0.2 writes zero for an empty window,
  and a zero entry lowers the floor, which is safe.

### Read-ahead is adaptive, not fixed

Each chunk is a separate range request, so a long scan pays one round trip per
chunk in series, 22 in a row for a 1Mb window on `1kg.chr1`. A sparse file,
though, has chunks the scan never reaches, and prefetching them multiplies the
bytes fetched with no benefit.

The read-ahead window therefore starts at one chunk and doubles each time the
scan finishes a chunk without ending. A query that stops inside its first chunk
issues exactly the reads a sequential scan would; a long one reaches the 6-chunk
cap after three. Six is the HTTP/1.1 per-host connection limit browsers enforce.

## Scanning lines

### The scan stops as soon as it is past the region

Lines are in coordinate order, so the first line with `start >= end` ends the
whole query, not just the chunk.

### The scan matches lines as bytes, and decodes only the ones that hit

The scan compares the reference name byte-for-byte against the encoded query
name and reads coordinates straight out of the buffer, so `TextDecoder` runs
only on lines that pass the range test. Tab offsets go into one reused
`Int32Array`.

For VCF, a single pass over the INFO field finds `END=` and `SVTYPE=TRA`, rather
than repeated `indexOf` for bytes that produce many false positives.

The one decode left produces the string the caller asked for. Handing over the
buffer range instead would let a caller that re-parses the line skip even that
decode, and we measured that API in the consumer that wanted it and rejected it
([ADR 0006](../agent-docs/architecture-decision-records/0006-getlines-hands-over-strings-not-buffer-ranges.md)).
A borrowed buffer would force that caller to restructure, the restructure gave
the whole speedup credited to the bytes, and the caller can make that change
alone.

### `indexOf` beats a hand-written single pass

The scan deliberately uses `Uint8Array.indexOf` even though the scans overlap
and a single pass would touch fewer bytes. V8 vectorizes `indexOf`, and in our
benchmark the single-pass replacement ran up to **2.96x slower** across nine
real VCF/BED/GFF files (ADR 0003). The byte-count argument does not predict
performance here.

## The chunk cache

### A chunk inside a cached one reads from it

`getLines` swaps each chunk the cache doesn't hold for the smallest cached or
in-flight chunk containing it, when that container overlaps no neighbouring
chunk of the query. The scan reads the container from its own start and skips
the lines before the query, as it does at any chunk's start.

Bytes read on real files, as median of cold 10kb windows (60 on the first two
files, 100 on the others) and total over five warm pans of 40 10kb windows
stepping 5kb:

| file                     | cold, main | cold, this | pan, main | pan, this |
| ------------------------ | ---------- | ---------- | --------- | --------- |
| RefSeq hg38 GFF3, chr1   | 97.4KB     | 97.4KB     | 362KB     | 362KB     |
| HPRC v2.1 MC graph links | 142.6KB    | 142.6KB    | 736KB     | 736KB     |
| NA12878 VCF, chr1        | 11.6KB     | 11.6KB     | 927KB     | 510KB     |
| C. elegans chrI BED      | 165.4KB    | 165.4KB    | 4,893KB   | 2,952KB   |

Every window returned the lines htslib's `tabix` returns.

The cache counts decompressed bytes, is sized above one query, and shares reads
already in flight, so concurrent queries hitting one chunk inflate it once.
[caching.md](caching.md) has the sizing measurements (ADRs 0001 and 0002).

## The header

`getHeader` and `getSkippedLines` answer different questions from the same
leading blocks, so both use one memoized parse. The parse keeps only the parsed
results, which matters for a VCF header that runs to megabytes.
`getSkippedLines` finds the N-th newline by scanning bytes and decodes only up
to it, instead of decoding and splitting the whole buffer to keep its first N
lines.

## Decompression

Inflate runs in wasm because inflate takes most of the time. libdeflate-in-wasm
beats a per-block JS inflate by 2.6-3.5x and matches native `zlib`, so no faster
codec is available, and the remaining gain comes from running blocks in parallel
with `bgzfWorkerPool`.

**A pool speeds tabix up less than BAM, 1.34-1.46x against 1.95x, because more
of a tabix query is serial, not because the pool is worse.** On a 213MB
multi-sample VCF the pool speeds decompression up 1.83x, and a warm-cache pass
measures the rest: 28% of that query is per-line byte scanning and string
decoding, which the pool does not parallelize. Amdahl's law on those two numbers
predicts 1.49x, against 1.45x measured. The serial share is largest where the
lines are widest, so a 1000-Genomes VCF is the worst case and a narrow-line BED
is not (jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md)).

The pooled call has a second serial cost. The workers return the blocks
separately and the calling thread concatenates them, a memcpy at 0.7-1.2 GB/s
that scales with the _decompressed_ size, so the copy costs most where
compression is best. On bgzf-filehandle's most compressible fixture, a bgzipped
GFF that inflates 18.6x, the four-worker call spends 58% of its time in that
copy. The copy is one reason the 1.83x is not higher, but it does not explain
the 1.4x end-to-end figure.

### The scan reads chunks in segments, so the copy is gone

`readChunk` returns bgzf-filehandle's `unzipChunkSegments`, one buffer per
worker, and the chunk cache holds those segments. `forEachLinePiece` hands the
scan each segment's complete lines as a view, with the piece's offset in the
joined chunk, and copies only a line that straddles two segments. The scan loop
itself is unchanged.

Cold `getLines` in headless Chrome on an i9-12900K, four workers, against the
joined build, both on bgzf-filehandle 6.8.0. The GFF rows are min (median) of
40, the rest the range of two runs of 15:

| query                          | lines   | segments vs joined |
| ------------------------------ | ------- | ------------------ |
| volvox.test.vcf contigA:0-50kb | 109     | 1.40-1.44x         |
| raw.g.vcf ctgA:0-50kb          | 29,883  | 1.05-1.10x         |
| ncbi_human GFF, 1Mb            | 2,785   | 1.26x (1.21x)      |
| out.sorted GFF, 1Mb            | 2,785   | 1.30x (1.23x)      |
| out.sorted GFF, whole file     | 350,741 | 1.11x (0.98x)      |
| chr22_nanopore BED, 2Mb        | 220     | 1.16-1.17x         |

The whole-file row is parity: decoding 350,000 line strings dominates it, and
its median sits 20-25% above its min.

**A node benchmark cannot measure any of this**, so every number above comes
from a browser. Under node `getSharedWorkerPool()` resolves to `undefined`, and
both arms of a node benchmark then run the in-process path and always report
parity.

[`@gmod/bam`'s ADR 0022](https://github.com/GMOD/bam-js/blob/main/agent-docs/architecture-decision-records/0022-the-wasm-boundary-sits-at-the-bgzf-block.md)
makes the full argument for why the call crosses the wasm boundary once per
chunk rather than once per record.
[bgzf-filehandle's optimizations doc](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/optimizations.md)
covers the wasm side: one wasm call per chunk, how the pool splits a chunk's
blocks across workers, and the designs its measurements rejected.

## The byte estimate stays an upper bound

`bytesForRegions` sums every chunk `blocksForRange` returns, which is more than
a sparse query reads — 3.6x on `ncbi_human.sorted.gff.gz`, 83x on one BED
fixture, and 1.00x on a dense VCF.

`@gmod/bam` narrows the same estimate by cutting the chunk list at the
linear-index entry one window past the query. We wrote that port, measured it
across every `.tbi` fixture here, and reverted it. The port is safe, since it
never forecast less than a query read, but exactly one row changed on this
corpus. It cannot help on the two kinds of file where a consumer's byte gate
fires in practice:

- A GFF whose first record spans the chromosome, as every NCBI RefSeq GFF's
  does, pins every linear-index entry to offset 0, so the bound cuts nothing.
- A dense VCF reads all of its few enormous chunks anyway.

The forecast needs a long candidate chunk list of which a query reads a short
prefix, and that list is a property of BAM files, not of tabix ones
([ADR 0005](../agent-docs/architecture-decision-records/0005-the-bam-chunk-forecast-does-not-transfer.md)).
ADR 0005 also records an earlier attempt that forecast _under_ the read, the
dangerous direction for a gate.

## What the consumer has to do

Some of the biggest wins are outside this library, because they are decisions
about the process rather than about the file.
[jbrowse-components](https://github.com/GMOD/jbrowse-components) makes these
decisions across its nine tabix-backed adapters:

- **One `bgzfWorkerPool` per JS context**, passed to every adapter rather than
  created per file. Inflating is the largest cost in the path above, and the
  pool is the only measure that speeds up inflate itself rather than the rest of
  the path. jbrowse creates one pool per RPC worker plus one on the main thread,
  since that is the scope with spare cores. Blocks cross as transferables, so
  the fan-out costs one pass over the compressed bytes and needs no cross-origin
  isolation. Expect less than the 1.95x `@gmod/bam` measures, for the reason in
  [Decompression](#decompression) above.
- **One `chunkCacheBudget` per JS context**, likewise, because `chunkCacheSize`
  is per file. On the BAM side, three deep tracks retained 1109MB while every
  cache stayed well under its 1GB ceiling. [caching.md](caching.md) covers the
  budget in full, with code.
- **A coalescing range cache under the filehandle**, which fetches in 256KB
  aligned blocks and joins contiguous runs into one request. The range cache
  composes with the chunk merging above rather than replacing it: the range
  cache dedups _bytes_, while the chunk cache dedups _decompression_. Keep the
  merge anyway, because for a consumer without such a layer the merge is the
  only step that turns a scattered bin set into a few requests
  ([`@gmod/bam`'s ADR 0011](https://github.com/GMOD/bam-js/blob/main/agent-docs/architecture-decision-records/0011-chunk-merging-stays-even-behind-a-range-cache.md)).
- **Consuming lines through the callback**, not by collecting them. `getLines`
  passes each line to the callback as it decodes it, and a caller that pushes
  every line into an array to parse afterwards holds a copy of the whole region
  as strings for no reason.
- **Gating on `bytesForRegions`** before issuing a query at all, and treating
  the result as the upper bound that
  [the byte estimate section](#the-byte-estimate-stays-an-upper-bound)
  describes.
