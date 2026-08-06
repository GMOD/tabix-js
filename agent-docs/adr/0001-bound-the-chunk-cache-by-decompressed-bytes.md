# ADR 0001 — The chunk cache is bounded by decompressed bytes

Status: Accepted

## Context

`TabixIndexedFile` caches the result of `readChunk` — a `ReadChunk`, whose
`buffer` is the chunk's fully **decompressed** bytes. We fetch compressed and
cache decompressed; those are different numbers, and the old cache conflated
them:

```ts
cache: new LRU({ maxSize: Math.floor(chunkCacheSize / (1 << 16)) })
```

`maxSize` in quick-lru is an **item count**, and the divisor is the max BGZF
_block_ size. So a `chunkCacheSize` of 5MB became "80 entries" — but an entry is
a whole chunk, which spans many blocks and is held inflated. quick-lru also
keeps between `maxSize` and `2 × maxSize` items by design, so the real ceiling
was 160 chunks of unbounded size.

How badly that misses is easy to underestimate. On
`test/data/1kg.chr1.subset.vcf.gz` — 213MB of samples packed into ~600kb of chr1
— panning 23 windows of 50kb peaked at **2027MB RSS**.

## Decision

Budget by decompressed bytes. `ByteBoundedChunkCache` implements the backing-
store interface `AbortablePromiseCache` expects and evicts from the
least-recently-used end until it is under budget. `chunkCacheSize` now means
bytes, and defaults to 100MB, matching `bam-js`'s `DEFAULT_MAX_CACHE_BYTES`.

A chunk's size is unknown until its read settles, so `set` records the entry
immediately and charges it to the budget on resolve. Unsettled entries are free,
which is the behaviour we want: they are reads a query is currently waiting on.

The `entries.size > 1` guard is kept from bam-js — a single chunk larger than
the whole budget is still cached, because the caller needs it for the query in
flight and dropping it only buys a re-decompress.

Evicting mid-query never causes a re-read: `getLines` holds every chunk's
promise in its `reads[]` array, and our `delete` is a plain `Map` delete that
does not touch `AbortablePromiseCache`'s abort path.

## Consequences

Panning the dense VCF above, 23 windows of 50kb:

| cache               | reads | fetched | peak cache | peak RSS |
| ------------------- | ----- | ------- | ---------- | -------- |
| old (80-entry LRU)  | 32    | 218MB   | 1600MB     | 2027MB   |
| byte 50MB           | 52    | 446MB   | 122MB      | 805MB    |
| byte 50MB, keep ≥ 2 | 42    | 339MB   | 222MB      |          |
| byte 50MB, keep ≥ 3 | 34    | 240MB   | 324MB      |          |
| byte 50MB, keep ≥ 4 | 32    | 218MB   | 406MB      |          |
| byte 250MB          | 34    | 250MB   | 249MB      |          |
| byte 500MB          | 32    | 218MB   | 497MB      |          |

Two things to read off it. The budget **does** thrash once the working set
exceeds it — 32 reads become 52, and bytes fetched double. And the minimum-entry
floor and the budget are the same dial: they trace one curve, so there is no
second knob to tune.

But the byte budget dominates the entry cache at every point on that curve. To
match the old 32 reads it needs ~400–500MB against the old 1600MB — the same I/O
for a quarter of the memory.

On ordinary files none of this bites. The same experiment on
`ncbi_human.sorted.gff.gz` reads 19 chunks at every budget from 10MB up, while
peak cache falls from 39.5MB to 10MB.

## What this does not fix

The cache unit is one index chunk, and on dense files that unit is simply too
big for any budget to work well.

It is tempting to blame `optimizeChunks`, which merges spans up to 5MB
_compressed_ — at this file's 7–8× ratio that would be 40MB inflated. **That is
not the cause.** The raw `.tbi` chunks for chr1 are already 17.65MB and 17.15MB
compressed before `optimizeChunks` sees them, so the 5MB limit cannot reach
them. A single finest-level bin covers 16kb of sequence, and in a file with
213MB across 600kb of coordinates that bin holds ~120MB decompressed. It is
index granularity, not merge policy — bounding merges by estimated decompressed
size would change nothing here.

The only way to a smaller unit is to cache at BGZF block level rather than chunk
level. `unzipChunkSlice` already computes the block boundaries (`cpositions` /
`dpositions`), so the information is there, but it changes the cache key and the
read path and wants its own ADR.
