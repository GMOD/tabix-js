# ADR 0001 — The chunk cache is bounded by decompressed bytes

Status: Accepted

## Context

`TabixIndexedFile` caches the result of `readChunk`, a `ReadChunk` whose
`buffer` holds the chunk's fully **decompressed** bytes. The reader fetches
compressed bytes and caches decompressed bytes, and the old cache conflated the
two sizes:

```ts
cache: new LRU({ maxSize: Math.floor(chunkCacheSize / (1 << 16)) })
```

`maxSize` in quick-lru is an **item count**, and the divisor is the max BGZF
_block_ size. So a `chunkCacheSize` of 5MB became "80 entries", but an entry is
a whole chunk, which spans many blocks and which the cache stores inflated.
quick-lru also keeps between `maxSize` and `2 × maxSize` items by design, so the
real ceiling was 160 chunks of unbounded size.

On `test/data/1kg.chr1.subset.vcf.gz`, which packs 213MB of samples into ~600kb
of chr1, the process peaked at **2027MB RSS** while panning 23 windows of 50kb.

## Decision

`ByteBoundedChunkCache` budgets by decompressed bytes, evicting from the
least-recently-used end until it is under budget, and implements the
backing-store interface `AbortablePromiseCache` expects. `chunkCacheSize` now
means bytes, and defaults to 100MB, matching `bam-js`'s
`DEFAULT_MAX_CACHE_BYTES`.

A chunk's size is unknown until its read settles, so `set` records the entry
immediately and charges it to the budget on resolve. An unsettled entry counts
as zero bytes, which is the behaviour we want, because it is a read that a query
is still waiting on.

We kept the `entries.size > 1` guard from bam-js, so the cache still holds a
single chunk larger than the whole budget. The caller needs that chunk for the
query in flight, and dropping it would only force a second decompress.

An eviction mid-query never causes a re-read, because `getLines` holds every
chunk's promise in its `reads[]` array, and our `delete` is a plain `Map` delete
that does not touch `AbortablePromiseCache`'s abort path.

## Consequences

A pan of 23 windows of 50kb across the dense VCF above gave these results:

| cache               | reads | fetched | peak cache | peak RSS |
| ------------------- | ----- | ------- | ---------- | -------- |
| old (80-entry LRU)  | 32    | 218MB   | 1600MB     | 2027MB   |
| byte 50MB           | 52    | 446MB   | 122MB      | 805MB    |
| byte 50MB, keep ≥ 2 | 42    | 339MB   | 222MB      |          |
| byte 50MB, keep ≥ 3 | 34    | 240MB   | 324MB      |          |
| byte 50MB, keep ≥ 4 | 32    | 218MB   | 406MB      |          |
| byte 250MB          | 34    | 250MB   | 249MB      |          |
| byte 500MB          | 32    | 218MB   | 497MB      |          |

The budget **does** thrash once the working set exceeds it: 32 reads become 52,
and bytes fetched double. The minimum-entry floor and the budget trace one
curve, so the floor is not a second parameter to tune.

The byte budget still dominates the entry cache at every point on the curve in
the table. To match the old 32 reads it needs ~400–500MB against the old cache's
1600MB, the same I/O for a quarter of the memory.

On an ordinary file such as `ncbi_human.sorted.gff.gz`, the same experiment
reads 19 chunks at every budget from 10MB up without thrashing, and peak cache
falls from 39.5MB to 10MB.

## Limitations

The cache unit is one index chunk, and on dense files that unit is too big for
any budget to work well.

`optimizeChunks` looks like the cause, since it merges spans up to 5MB
_compressed_, which at this file's 7–8× ratio would be 40MB inflated. **It is
not the cause.** The raw `.tbi` chunks for chr1 are already 17.65MB and 17.15MB
compressed before `optimizeChunks` sees them, so the 5MB limit cannot reach
them. A single finest-level bin covers 16kb of sequence, and in a file with
213MB across 600kb of coordinates that bin holds ~120MB decompressed. The index
granularity sets the chunk size, not the merge policy, so bounding merges by
estimated decompressed size would change nothing here.

A smaller unit requires caching at BGZF block level rather than chunk level.
`unzipChunkSlice` already computes the block boundaries (`cpositions` /
`dpositions`), but block-level caching changes the cache key and the read path,
so it needs an ADR of its own.
