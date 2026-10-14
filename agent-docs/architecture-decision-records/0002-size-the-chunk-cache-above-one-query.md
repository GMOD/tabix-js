# ADR 0002 — Size the chunk cache above one query, and reclaim it when idle

Status: Accepted (`DEFAULT_CHUNK_CACHE_BYTES` 100 MB → 1 GB; adds
`chunkCacheIdleTimeoutMs`, default 3 minutes, and `clearChunkCache`)

## Context

ADR 0001 bounded this cache by decompressed bytes rather than entry count,
because a dense VCF has single index bins of 17 MB compressed / **120 MB
decompressed** and an entry count does not bound memory. It set the budget at
100 MB.

The 100 MB budget contradicts the 120 MB measurement: **one entry did not fit in
the budget**, and nobody noticed for seven months. A budget below one query's
working set caches _nothing_. The cache evicts each entry before the next pan
can reuse it, so the hit rate is zero, every pan pays for the decompress again,
and the cache retains the memory anyway.

We measured the fixture from ADR 0001, `test/data/1kg.chr1.subset.vcf.gz`, with
an unbounded cache:

| window | entries | working set | of the old 100 MB default |
| ------ | ------: | ----------: | ------------------------: |
| 10kb   |   **1** |    105.5 MB |                      106% |
| 50kb   |       5 |    269.6 MB |                      270% |
| 200kb  |      10 |    703.4 MB |                      703% |

Every realistic query width exceeded the budget, including the narrowest, and at
10kb a _single_ entry exceeds it. The second pass of a six-window 50kb pan gave
these results:

| budget | warm pass | refills   | held   |
| ------ | --------: | --------- | ------ |
| 100 MB |    2596ms | **17/17** | 19 MB  |
| 400 MB |    1244ms | 5/9       | 392 MB |
| 800 MB | **600ms** | **0/9**   | 497 MB |
| ∞      |     617ms | 0/9       | 497 MB |

At 100 MB the cache refilled 17 of 17 entries, so it returned nothing it was
asked for, and it still held 19 MB.

## Decision

- `DEFAULT_CHUNK_CACHE_BYTES = 1024 * 2 ** 20`. The knee is 800 MB and the
  working set plateaus at 497 MB, so 1 GB is above both with headroom, and a
  budget above 800 MB gains nothing.
- `chunkCacheIdleTimeoutMs`, default 3 minutes, `0` opts out.
- `clearChunkCache()`, and `chunkCache` becomes public so it is testable.

## Consequences / rationale

- **A consumer on ordinary data pays nothing.** The budget is a ceiling, not an
  allocation, so the cache for a small VCF holds the same bytes at any setting.
  The budget limits the cache only where the old default was returning a 0% hit
  rate.

- **The idle timeout makes the ceiling affordable.** The cache applies the
  budget when a read settles, so the budget does nothing at all for a consumer
  sitting still, and a genome browser holds one of these caches per open track.
  The timeout runs from the last _read_ of a chunk, not the fetch, so panning
  back and forth over one region never expires it. A test pins this behaviour at
  160s elapsed against a 60s timeout with zero re-reads.

- **The budget bounds retention, not peak memory.** The cache never evicts a
  read in flight, and it keeps the last settled entry whatever the budget. ADR
  0001 called the budget "the only bound"; it bounds retention, and the docs now
  say which.

- **Don't pick a budget between one query's working set and several.** In that
  range the cache costs memory and returns nothing, and the old 100 MB default
  was in that range.

- The design, defaults and naming match @gmod/bam 8.3.0 (bam's ADR 0014/0015)
  and @gmod/cram 11.2.0 (cram's ADR 0004), which had the same problem at the
  same time because they use the same shared cache.

## Methodology

We measured working sets with `chunkCacheSize: Infinity`. With a budget applied,
`totalSize` reports what survived eviction rather than what the query needed,
and on this fixture that understates the working set by 5x. The runs used
`LocalFile`, so a refill cost only a decompress. Over HTTP each refill also
costs a round trip, which widens every gap above.
