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
