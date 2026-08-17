# Caching

`TabixIndexedFile` caches decompressed chunks — the unit the index hands out —
so overlapping and adjacent queries reuse inflated bytes instead of fetching and
inflating them again. Three constructor options bound that cache, and each
answers a different question.

| option                    | default | question                                     |
| ------------------------- | ------- | -------------------------------------------- |
| `chunkCacheSize`          | 1GB     | how much may _this file_ retain?             |
| `chunkCacheIdleTimeoutMs` | 3min    | how long may it retain it while idle?        |
| `chunkCacheBudget`        | none    | how much may _all my files together_ retain? |

`clearChunkCache()` drops everything immediately and stops the idle sweep until
something is cached again — for a consumer that knows it is done with a file,
where the idle timeout is for one the user has wandered away from.

## `chunkCacheSize` never refuses a read

The cache never turns a chunk away for being too large, eviction never touches a
read in flight, and it only ever drops a value it has already handed back. So
the worst a budget can cost you is a re-read: it can make a query slower, never
make one fail or come back short.

Unbounded is the permissive setting rather than the safe one, which is why there
is a default at all — a cache with no ceiling grows for the life of the file,
and this library measured **2GB RSS** panning a dense VCF before it bounded
this.

## The unit changed in v3.5.2, and a pinned value did not

`chunkCacheSize` is **decompressed bytes**. Before v3.5.2 the same option was
divided by 64KB to get an entry count, so `50 * 2**20` used to ask for 800 whole
chunks — effectively unbounded — and now asks for 50MB, twenty times under the
default. The name did not change, so nothing warns.

That is not hypothetical: jbrowse passed exactly that value in nine adapters,
and on `1kg.chr1.subset.vcf.gz` it was a **total miss** — 47 refills out of 47
on the warm pass against 0 at the default, while holding 82.7MB in a single
entry, over the budget it had been given. If you pinned a number here before
v3.5.2, re-read it.
([ADR 0001](../agent-docs/adr/0001-bound-the-chunk-cache-by-decompressed-bytes.md))

## Don't pick a number between one query and several

Below one query's working set the cache turns against you. Each chunk falls out
before the next pan can reuse it, so the hit rate is zero, every pan pays the
inflate again, and the memory is held anyway — a read in flight is never
evicted, and the last settled entry is kept whatever the budget.

Measured on `1kg.chr1.subset.vcf.gz`, a six-window pan took 17 refills out of 17
at 100MB against 0 at 800MB, and **2596ms against 600ms**. Size above the
working set, or leave the default alone.
([ADR 0002](../agent-docs/adr/0002-size-the-chunk-cache-above-one-query.md))

Entry count is a bad proxy for that size, which is why the option counts bytes:
we fetch compressed and cache decompressed, and one bin of that same VCF is 17MB
compressed against 120MB inflated.

## `chunkCacheIdleTimeoutMs` is what gives memory back

The cache checks its ceiling when a read settles, so an idle one sits at
whatever level it reached. The idle sweep is what makes a 1GB default a peak
reached while panning rather than a level a parked tab holds forever. Pass `0`
to disable it.

## `chunkCacheBudget` is what bounds a consumer with many files

`chunkCacheSize` is per file, which bounds nothing for a consumer that opens one
file per track. Pass one `SharedBudget` per JS context and hand it to every
file:

```typescript
import { SharedBudget } from '@gmod/shared-read-cache'

const chunkCacheBudget = new SharedBudget(1 << 30) // 1GB across every file

const vcf = new TabixIndexedFile({ url, chunkCacheBudget })
const gff = new TabixIndexedFile({ url: gffUrl, chunkCacheBudget })
```

Members yield whatever is globally least-recently-used, so files nobody is
reading hand their space to the one being panned. Dividing `chunkCacheSize` by
the track count instead walks straight into the cliff above.

The budget is `@gmod/shared-read-cache`'s, not this library's, so `@gmod/bam`
and `@gmod/cram` can join the same one — which is the point, since a genome
browser's memory problem is the sum across formats rather than any one of them.
The BAM side measured the shape: six tracks browsing six windows retained 1442MB
with every cache still under its own ceiling.

## None of these bound peak memory

They bound retained decompressed bytes. Reads in flight are never evicted, the
last settled entry is always kept, and whatever your line callback keeps is
yours. Size them against what you want to _keep_, and bound total memory
somewhere that can see the whole process.

## Concurrent queries share a read

Two queries hitting one chunk fetch and inflate it once — the second joins the
first's promise rather than starting its own. Aborting is per caller: a chunk
shared between callers is only abandoned once every joined caller has aborted,
so one cancelled query cannot drop a block another still needs.

## A hit needs the same chunk span, not just the same bytes

An entry's key is the _merged_ chunk span a query resolved to, and merging
depends on the query — `blocksForRange` clamps to the lowest offset the linear
index gives for that start, then joins what is left. Two overlapping pans can
therefore decode the same bytes under two keys and miss each other.

Unmeasured here, unlike on the BAM side where it is known and parked, so treat
it as a reason not to read a low hit rate as a bug before checking whether the
spans matched.

## Further reading

[optimizations.md](optimizations.md#the-chunk-cache) covers the same ground from
the inside, and the ADRs behind it are in
[`agent-docs/adr/`](../agent-docs/adr/).
