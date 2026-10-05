# ADR 0002 — Size the chunk cache above one query, and reclaim it when idle

Status: Accepted (`DEFAULT_CHUNK_CACHE_BYTES` 100 MB → 1 GB; adds
`chunkCacheIdleTimeoutMs`, default 3 minutes, and `clearChunkCache`)

## Context

ADR 0001 bounded this cache by decompressed bytes rather than entry count,
because a dense VCF has single index bins of 17 MB compressed / **120 MB
decompressed** and an entry count says nothing about memory. It set the budget
at 100 MB.

That number and that measurement contradict each other, and nobody noticed for
seven months: **one entry did not fit in the budget**. A budget below one
query's working set does not cache less, it caches _nothing_ — each entry is
evicted before the next pan can reuse it, so the hit rate is zero, the
decompress is paid again every time, and the memory is retained anyway.

Measured on ADR 0001's own fixture, `test/data/1kg.chr1.subset.vcf.gz`, with an
unbounded cache:

| window | entries | working set | of the old 100 MB default |
| ------ | ------: | ----------: | ------------------------: |
| 10kb   |   **1** |    105.5 MB |                      106% |
| 50kb   |       5 |    269.6 MB |                      270% |
| 200kb  |      10 |    703.4 MB |                      703% |

Every realistic query width was over the line, including the narrowest — and at
10kb the entire overage is a _single_ entry. Six-window 50kb pan, second pass:

| budget | warm pass | refills   | held   |
| ------ | --------: | --------- | ------ |
| 100 MB |    2596ms | **17/17** | 19 MB  |
| 400 MB |    1244ms | 5/9       | 392 MB |
| 800 MB | **600ms** | **0/9**   | 497 MB |
| ∞      |     617ms | 0/9       | 497 MB |

17 out of 17 is a total miss: the cache returned nothing it was asked for, while
holding 19 MB for the privilege.

## Decision

- `DEFAULT_CHUNK_CACHE_BYTES = 1024 * 2 ** 20`. The knee is 800 MB and the
  working set plateaus at 497 MB, so 1 GB clears it with headroom and nothing
  above 800 MB buys anything.
- `chunkCacheIdleTimeoutMs`, default 3 minutes, `0` opts out.
- `clearChunkCache()`, and `chunkCache` becomes public so it is testable.

## Consequences / rationale

- **Costs a consumer on ordinary data nothing.** The budget is a ceiling, not an
  allocation — a small VCF holds what it holds at any setting. It binds only
  where the old default was returning a 0% hit rate.

- **The idle timeout is what makes the ceiling affordable.** The budget is
  applied when a read settles, so it does nothing at all for a consumer sitting
  still, and a genome browser holds one of these per open track. Timed from the
  last _read_ of a chunk, not the fetch, so panning back and forth over one
  region never expires it — pinned by a test at 160s elapsed against a 60s
  timeout with zero re-reads.

- **Still a retention bound, not a peak-memory bound.** Reads in flight are
  never evicted and the last settled entry is kept whatever the budget. ADR 0001
  called this "the only bound"; it bounds retention, and the docs now say which.

- **Don't pick a number between one query and several.** That is the region
  where the cache costs memory and returns nothing — which is exactly where 100
  MB sat.

- Same shape, defaults and naming as @gmod/bam 8.3.0 (its ADR 0014/0015) and
  @gmod/cram 11.2.0 (its ADR 0004), which hit the identical problem at the same
  time from the same shared cache.

## Methodology

Working sets measured with `chunkCacheSize: Infinity`. With a budget applied,
`totalSize` reports what survived eviction rather than what the query needed — a
mistake worth avoiding deliberately, since on this fixture it understates by 5x.
`LocalFile`, so a refill costs decompress only; over HTTP each also costs a
round trip, widening every gap above.
