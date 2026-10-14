# Caching

`TabixIndexedFile` caches decompressed chunks, the unit the index returns for a
query, so overlapping and adjacent queries reuse inflated bytes instead of
fetching and inflating them again. Three constructor options bound that cache,
and the table lists the question each one settles.

| option                    | default | question                                     |
| ------------------------- | ------- | -------------------------------------------- |
| `chunkCacheSize`          | 1GB     | how much may _this file_ retain?             |
| `chunkCacheIdleTimeoutMs` | 3min    | how long may it retain it while idle?        |
| `chunkCacheBudget`        | none    | how much may _all my files together_ retain? |

`clearChunkCache()` drops everything immediately and stops the idle sweep until
the cache holds something again. Call it when the consumer knows it is done with
a file; the idle timeout covers a file the user has stopped looking at.

## `chunkCacheSize` never refuses a read

The cache accepts a chunk of any size, never evicts a read in flight, and drops
only a value it has already returned. The worst a budget can cost you is
therefore a re-read, which can make a query slower but never makes one fail or
come back short.

An unbounded cache is the permissive setting rather than the safe one, which is
why the option has a default at all. A cache with no ceiling grows for the life
of the file, and before the cache had a bound we measured **2GB RSS** while
panning a dense VCF.

## The unit changed in v3.5.2, and a pinned value did not

`chunkCacheSize` is **decompressed bytes**. Before v3.5.2 the library divided
the same option by 64KB to get an entry count, so `50 * 2**20` asked for 800
whole chunks, which was effectively unbounded. The same value now asks for 50MB,
twenty times under the default. The option name did not change, so the library
gives no warning.

jbrowse passed exactly that value in nine adapters, and on
`1kg.chr1.subset.vcf.gz` the cache was a **total miss**: 47 refills out of 47 on
the warm pass against 0 at the default, while it held 82.7MB in a single entry,
over the budget it had been given. If you pinned a number here before v3.5.2,
re-read it.
([ADR 0001](../agent-docs/architecture-decision-records/0001-bound-the-chunk-cache-by-decompressed-bytes.md))

## Don't pick a number between one query and several

A budget below one query's working set costs memory and saves no work. The cache
evicts each chunk before the next pan can reuse it, so the hit rate is zero and
every pan pays for the inflate again. The cache holds the memory anyway, because
it never evicts a read in flight and keeps the last settled entry whatever the
budget.

On `1kg.chr1.subset.vcf.gz`, a six-window pan took 17 refills out of 17 at 100MB
against 0 at 800MB, and **2596ms against 600ms**. Size above the working set, or
leave the default alone.
([ADR 0002](../agent-docs/architecture-decision-records/0002-size-the-chunk-cache-above-one-query.md))

The option counts bytes because an entry count is a bad proxy for the working
set. The reader fetches compressed bytes and caches decompressed ones, and one
bin of the 1kg VCF is 17MB compressed against 120MB inflated.

## `chunkCacheIdleTimeoutMs` gives memory back

The cache checks its ceiling when a read settles, so an idle cache stays at
whatever size it reached. With the idle sweep, the 1GB default is a peak reached
while panning rather than a size that an idle tab holds forever. Pass `0` to
disable it.

## `chunkCacheBudget` bounds a consumer with many files

`chunkCacheSize` is per file, so it does not bound the total for a consumer that
opens one file per track. Create one `SharedBudget` per JS context and pass it
to every file:

```typescript
import { SharedBudget } from '@gmod/shared-read-cache'

const chunkCacheBudget = new SharedBudget(1 << 30) // 1GB across every file

const vcf = new TabixIndexedFile({ url, chunkCacheBudget })
const gff = new TabixIndexedFile({ url: gffUrl, chunkCacheBudget })
```

The shared budget evicts whatever is least recently used across all its members,
so files nobody is reading give up their space to the one being panned. Dividing
`chunkCacheSize` by the track count instead can put each file below one query's
working set, the problem described above.

`SharedBudget` comes from `@gmod/shared-read-cache`, not from this library, so
`@gmod/bam` caches can join the same budget. A genome browser's memory problem
is the sum across formats rather than any one of them, so one budget should
cover them all. bam-js measured that sum: six tracks browsing six windows
retained 1442MB while every cache stayed under its own ceiling.

**Group members by unit.** A budget's total is a sum over its members, so the
total means nothing unless every member weighs the same thing. `@gmod/bam` and
this library both weigh decompressed bytes and can share a budget. `@gmod/cram`
weighs decoded _records_ and `@gmod/bbi` weighs entries, so a budget holding a
tabix cache and a cram cache adds bytes to records and bounds neither. `sizeOf`
is opaque by design, so the budget cannot check the units for you; give each
unit a separate budget.

## None of these bound peak memory

The three options bound retained decompressed bytes. The cache never evicts a
read in flight and always keeps the last settled entry, and whatever your line
callback keeps is outside the cache. Size the options against what you want to
_keep_, and bound total memory in code that can see the whole process.

## Concurrent queries share a read

When two queries need one chunk, the cache fetches and inflates it once, and the
second query joins the first one's promise rather than starting its own.
Aborting is per caller: the cache abandons a shared chunk only after every
caller that joined it has aborted, so one cancelled query cannot drop a block
another still needs.

## A hit needs the same chunk span, not just the same bytes

An entry's key is the _merged_ chunk span for a query, and the merge depends on
the query: `blocksForRange` clamps to the lowest offset the linear index gives
for that start, then joins what is left. Two overlapping pans can therefore
decode the same bytes under two keys and miss each other.

tabix-js has not measured how often this happens; bam-js has measured it and set
it aside. Before treating a low hit rate as a bug, check whether the spans
matched.

## Further reading

[optimizations.md](optimizations.md#the-chunk-cache) describes how the cache is
implemented, and the ADRs behind it are in
[`agent-docs/architecture-decision-records/`](../agent-docs/architecture-decision-records/).
