# Backlog

Work that is worth doing and is not done. Each entry says what to do **first**,
because most of these are blocked on a measurement rather than on typing —
`agent-docs/adr/` is full of changes that were obvious, unmeasured, and wrong.

Decisions that are settled, including the ones that reject an optimization, live
in [adr/](adr/) rather than here.

| Item                                                                                                                    | First move                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [The per-line scan is the last large movable thing](#the-per-line-scan-is-the-last-large-movable-thing-in-a-query)      | profile the scan on a wide-line VCF; the pool has taken what it can reach |
| [A cache hit needs the same merged span](#a-cache-hit-needs-the-same-merged-chunk-span-and-nobody-has-priced-that-here) | count distinct cache keys over a pan, before designing anything           |
| [`onProgress` is coarse on a one-chunk query](#onprogress-is-all-or-nothing-on-a-query-that-resolves-to-one-chunk)      | decide whether per-block ticks are worth the callback volume              |
| [Sweep the sibling parsers' docs](#sweep-the-sibling-parsers-for-the-doc-gaps-found-here)                               | grep the four wrapper repos for the same two errors                       |

## The per-line scan is the last large movable thing in a query

The worker pool takes a tabix query 1.34-1.46x end to end, and a warm-cache
split puts the decompression it reaches at 1.83x — leaving **28% of a cold query
in per-line byte scanning and string decoding**, which no worker count touches
(jbrowse-components'
[BGZF_WORKER_POOL.md](https://github.com/GMOD/jbrowse-components/blob/main/agent-docs/reference/BGZF_WORKER_POOL.md)).
Amdahl on those two figures predicts 1.49x against 1.45x measured, so the
accounting is closed: the scan is what is left.

It is worst exactly where it was measured — 1000 Genomes records carry a
genotype field per sample and run to ~60KB a line — and a narrow-line BED sits
closer to BAM's 1.95x. So **profile a wide-line VCF specifically**, and expect
the answer to be about `TextDecoder` volume rather than about the tab scan:
[ADR 0003](adr/0003-keep-indexof-based-byte-scans.md) already rejected
hand-rolling the byte walk, and it lost to `indexOf` by up to 2.96x.

The one thing this rules out is handing the caller bytes instead of a string —
that was proposed, measured in the consumer that wanted it, and rejected in
[ADR 0006](adr/0006-getlines-hands-over-strings-not-buffer-ranges.md). Anything
here has to make the decode cheaper, not move it to the caller.

## A cache hit needs the same merged chunk span, and nobody has priced that here

`blocksForRange` clamps to the linear index's lowest offset for the query start
and then merges what is left, and the chunk cache keys on the merged span. So
two overlapping pans can decode the same bytes under two keys and miss each
other.

`@gmod/bam` measured this on its side, found it costs short-read files real work
and leaves deep long-read data untouched, and parked it. Nothing equivalent has
been measured here, which makes a low hit rate ambiguous — it may be the cliff
in [ADR 0002](adr/0002-size-the-chunk-cache-above-one-query.md) or it may be
this.

**First move is a count, not a fix:** run a pan over a dense VCF and a sparse
GFF, log the cache key per read, and see how many distinct keys cover the same
bytes. If the answer is "almost none", this entry closes and
[docs/caching.md](../docs/caching.md) loses a caveat.

## `onProgress` is all-or-nothing on a query that resolves to one chunk

`getLines` ticks once per chunk, and a chunk is a run of blocks — so a query
that resolves to a single large chunk reports 0% and then 100%, which is the
case a progress bar exists for. The block boundaries are already known:
`cpositions`/`dpositions` come back from the decompressor with the buffer.

What has to be decided first is whether that is worth the callback volume. A
64KB-block file at 1MB of compressed chunk is 16 ticks where there is now 1, and
a consumer that re-renders per tick pays for all of them. A cheaper shape is to
tick per block only while a chunk exceeds some size, which keeps the common
query at one tick apiece.

## Sweep the sibling parsers for the doc gaps found here

Two errors were found writing [docs/caching.md](../docs/caching.md), and both
are the kind that copy across repos:

- `onProgress` was documented as firing per **block** when it fires per
  **chunk**, in the README, in `docs/api.md`, and in a source comment that
  managed to claim both in one sentence.
- `chunkCacheBudget` and `bgzfWorkerPool` were absent from the API table
  entirely — the two options that decide a genome browser's memory and its
  decompression throughput.

A third was found by comparing against the siblings rather than inside this
repo: both the API comment and `docs/caching.md` said `@gmod/cram` could join a
`chunkCacheBudget`, and it cannot — cram weighs decoded _records_ where this
library weighs bytes, so the sum bounds neither. Fixed here; `@gmod/bam` never
made the claim.

`vcf-js`, `gff-nostream`, `bed-js` and `twobit-js` wrap the same reader or the
same filehandle and plausibly carry the same omissions. Check the option tables
against the constructors rather than against each other.

**The caching-doc side of that sweep is done, and the answer was "nothing to
add"** (2026-08-16). Only three of these repos expose cache knobs at all:
`@gmod/bam` and this one, which now carry matching `docs/caching.md`, and
`@gmod/cram`, whose `cacheSize`/`cacheIdleTimeoutMs`/`cacheBudget` are covered
completely by `docs/api.md` § "The cache options" and `docs/memory.md` § "The
slice cache" — a different filename, not a gap, and moving them would break the
cross-links those two docs already have. `@gmod/bbi` and `@gmod/hic` expose
none: their caches are internal and fixed (bbi's R-tree node cache is 1000
entries, hic's block cache is a byte-bounded LRU behind two constants), so a
consumer-facing caching doc there would have nothing to document.

What that leaves, for whoever picks it up in those two repos, is a **code**
question rather than a docs one: neither lets a consumer bound its caches, and
bbi's node cache is bounded by entry count with entries of variable size. That
is the shape [ADR 0001](adr/0001-bound-the-chunk-cache-by-decompressed-bytes.md)
rejected here.
