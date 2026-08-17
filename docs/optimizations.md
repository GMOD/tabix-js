# Optimizations

Why the query path looks the way it does. [dataflow.md](dataflow.md) draws the
path itself.

Most of it exists because two things dominate a query: network round trips, and
inflating more bytes than the answer needs.

## Reading the index

### Parsed once, shared across callers

The first query reads the whole `.tbi`/`.csi`, inflates it, parses it, and
memoizes the result for the life of the object.

Shared, not merely memoized: the parse runs under a signal of its own and aborts
only once every caller waiting on it has given up, so a query that pans away
can't abort the index read concurrent queries depend on. `getIndices(refId)` is
separately LRU-memoized so repeated lookups don't re-walk the parsed bytes.

### One allocation for the linear-index scan

Finding the minimum virtual offset visits every linear-index entry in the file —
301k of them on `test/data/failing_tabix.vcf.gz.tbi`, against 19k bin chunks. So
`minVirtualOffset` compares packed offsets in place and allocates at most one
`VirtualOffset` instead of one per entry.

## Choosing and fetching chunks

### Prune, merge and clamp before fetching anything

`blocksForRange` collects a chunk per overlapping bin at every level, far more
than a query reads. Before any I/O, `optimizeChunks`:

- drops chunks ending at or before the linear-index floor, _before_ sorting;
- merges neighbours within 65KB (up to a 5MB span), so adjacent bins become one
  range request;
- trims overlaps, so no fetch covers the same byte twice.

`clampChunkEnds` then pulls each chunk's end down to the next known BGZF block
boundary rather than over-reading a full maximum-size block — smaller fetches
and a smaller `bytesForRegions` estimate, with no extra I/O.

### Read-ahead is earned, not fixed

Every chunk is its own range request, so a long scan pays a round trip per chunk
serially — 22 in a row for a 1Mb window on `1kg.chr1`. But a sparse file offers
chunks the scan never reaches, and prefetching those multiplies the bytes for
nothing.

So the window starts at one and doubles each time the scan finishes a chunk
without ending. A query that stops inside its first chunk issues exactly the
reads a sequential scan would; a long one reaches the 6-chunk cap after three.
Six is the HTTP/1.1 per-host connection limit browsers enforce.

## Scanning lines

### The scan stops as soon as it is past the region

Lines are in coordinate order, so the first line with `start >= end` ends the
whole query, not just the chunk.

### The scan matches lines as bytes, and decodes only the ones that hit

It compares the reference name byte-for-byte against the encoded query name and
reads coordinates straight out of the buffer, so `TextDecoder` runs only on
lines that survive the range test. Tab offsets go into one reused `Int32Array`.

For VCF, a single pass over the INFO field finds `END=` and `SVTYPE=TRA`, rather
than repeated `indexOf` for bytes that produce many false positives.

The decode that survives is the one the caller asked for, and handing over the
buffer range instead — so a caller that re-parses the line could skip even that
— was measured in the consumer that wanted it and rejected
([ADR 0006](../agent-docs/adr/0006-getlines-hands-over-strings-not-buffer-ranges.md)).
The restructure a borrowed buffer forces on that caller turned out to be worth
everything the bytes were credited with, and the caller can do it alone.

### `indexOf` beats a hand-written single pass

The scanning itself deliberately uses `Uint8Array.indexOf` even though the scans
overlap and a single pass would touch fewer bytes.

Measured: V8 vectorizes `indexOf`, and the single-pass replacement ran up to
**2.96x slower** across nine real VCF/BED/GFF files (ADR 0003). The byte-count
argument does not predict performance here.

## The chunk cache

The cache counts decompressed bytes rather than entries, and we size it above
one query. We fetch compressed and cache decompressed, so entry count says
nothing about memory — a single bin of `1kg.chr1.subset.vcf.gz` is 17MB
compressed and 120MB inflated.

Sizing it below one query's working set does not cache less, it caches
_nothing_: each entry falls out before the next pan can reuse it, so the hit
rate is zero and every pan pays the inflate again. Measured on that fixture, a
six-window pan took 17 refills out of 17 at 100MB against 0 at 800MB, and 2596ms
against 600ms (ADRs 0001 and 0002).

The cache also shares reads already in flight, so concurrent queries hitting one
chunk inflate it once. A three minute idle timeout makes the 1GB default a peak
under panning rather than a resting level, and `chunkCacheBudget` lets many
files share one ceiling instead of each holding its own.

## The header

`getHeader` and `getSkippedLines` answer different questions from the same
leading blocks, so one memoized parse serves both. It keeps only the parsed
results, which matters for a VCF header running to megabytes. `getSkippedLines`
finds the N-th newline by scanning bytes and decodes only up to it, instead of
decoding and splitting the whole buffer to keep its first N lines.

## Decompression

Inflate is in wasm because that is where the time is. libdeflate-in-wasm beats a
per-block JS inflate by 2.6-3.5x and sits at parity with native `zlib`, so there
is no faster codec to reach for; the remaining headroom is running blocks in
parallel, i.e. `bgzfWorkerPool`.

**A pool is worth less here than it is for BAM, and the reason is structural.**
A pooled call gets one buffer per block back and concatenates them on the
calling thread, work the sequential path does inside wasm as part of the same
call. That memcpy runs at 0.7-1.2 GB/s, no worker count touches it, and it
scales with the _decompressed_ size — so it is worst where compression is best.
Tabix files are text: bgzf-filehandle measures a bgzipped GFF at 2.49x on the
inflate itself and **flat at ~1.0x end to end**, reassembly being 58% of the
four-worker call, where its BAM fixtures are 1.8-2.1x end to end.

Note also that **node cannot measure any of this**: `getSharedWorkerPool()`
resolves to `undefined` there, so both arms of a node benchmark run the
in-process path and report parity forever. That question needs a browser.

[`@gmod/bam`'s ADR 0022](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0022-the-wasm-boundary-sits-at-the-bgzf-block.md)
makes the full argument, and says why the call crosses the boundary once per
chunk rather than per record. What happens on the other side — one wasm call per
chunk, how the pool splits a chunk's blocks across workers, and what measuring
there rejected — is
[bgzf-filehandle's own optimizations doc](https://github.com/GMOD/bgzf-filehandle/blob/main/docs/optimizations.md).

## The byte estimate is honest about being an upper bound

`bytesForRegions` sums every chunk `blocksForRange` offers, which is more than a
sparse query reads — 3.6x on `ncbi_human.sorted.gff.gz`, 83x on one BED fixture,
and 1.00x on a dense VCF.

`@gmod/bam` narrows the same estimate by cutting the chunk list at the
linear-index entry one window past the query. We wrote that port, measured it
across every `.tbi` fixture here, and reverted it: it is safe — it never
forecast under what a query read — but exactly one row moved on this corpus. The
two shapes where a consumer's byte gate actually fires are the two it cannot
help with: a GFF whose first record spans the chromosome pins every linear-index
entry to offset 0, so the bound orders nothing (every NCBI RefSeq GFF opens that
way), and a dense VCF reads all of its few enormous chunks anyway. The premise
the forecast needs — a long candidate chunk list of which a query reads a short
prefix — is a BAM property, not a tabix one
([ADR 0005](../agent-docs/adr/0005-the-bam-chunk-forecast-does-not-transfer.md),
which also records an earlier attempt that forecast _under_ the read, the
dangerous direction for a gate).

## What the consumer has to do

Some of the biggest wins are not in this library at all, because they are
decisions about the process rather than about the file. What
[jbrowse-components](https://github.com/GMOD/jbrowse-components) does across its
nine tabix-backed adapters, as the worked example:

- **One `bgzfWorkerPool` per JS context**, passed to every adapter rather than
  created per file. Inflating is the largest cost in the path above and the pool
  is the only lever that attacks it rather than the remainder. One per RPC
  worker plus one on the main thread, that being the scope with spare cores.
  Blocks cross as transferables, so the fan-out costs one pass over the
  compressed bytes and needs no cross-origin isolation. Expect less than the
  1.95x `@gmod/bam` measures, for the reason in [Decompression](#decompression)
  above.
- **One `chunkCacheBudget` per JS context**, likewise. `chunkCacheSize` is per
  file, which bounds nothing for a consumer that opens one file per track:
  measured on the BAM side, three deep tracks retained 1109MB with every cache
  well under its own 1GB ceiling. A shared budget also lets tracks nobody is
  looking at yield their space to the one the user is panning, where dividing
  the ceiling by the track count walks into the cliff above.
  [caching.md](caching.md) is the whole of it, with the code.
- **A coalescing range cache under the filehandle**, fetching in 256KB aligned
  blocks and joining contiguous runs into one request. It composes with the
  chunk merging above rather than replacing it — that layer dedups _bytes_ while
  the chunk cache dedups _decompression_ — and is no reason to drop the merge,
  since a consumer without such a layer has only the merge turning a scattered
  bin set into a few requests
  ([`@gmod/bam`'s ADR 0011](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0011-chunk-merging-stays-even-behind-a-range-cache.md)).
- **Consuming lines through the callback**, not by collecting them. `getLines`
  hands each line over as it decodes it; a caller that pushes them all into an
  array to parse afterwards holds a copy of the whole region as strings for no
  reason.
- **Gating on `bytesForRegions`** before issuing a query at all — reading it as
  the upper bound the section above says it is.
