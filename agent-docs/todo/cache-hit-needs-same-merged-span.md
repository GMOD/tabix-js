---
name: cache-hit-needs-same-merged-span
description:
  Whether overlapping pans decode the same bytes under two chunk-cache keys and
  miss each other.
metadata:
  category: measure
  area: cache
  first_move: 'Count distinct cache keys over a pan, before designing anything.'
  order: 1
---

# A cache hit needs the same merged chunk span, and nobody has priced that here

`blocksForRange` clamps to the linear index's lowest offset for the query start
and then merges what is left, and the chunk cache keys on the merged span. So
two overlapping pans can decode the same bytes under two keys and miss each
other.

`@gmod/bam` measured this on its side, found it costs short-read files real work
and leaves deep long-read data untouched, and parked it. Nothing equivalent has
been measured here, which makes a low hit rate ambiguous — it may be the cliff
in
[ADR 0002](../architecture-decision-records/0002-size-the-chunk-cache-above-one-query.md)
or it may be this.

**First move is a count, not a fix:** run a pan over a dense VCF and a sparse
GFF, log the cache key per read, and see how many distinct keys cover the same
bytes. If the answer is "almost none", this entry closes and
[docs/caching.md](../../docs/caching.md) loses a caveat.
