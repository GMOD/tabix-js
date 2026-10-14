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

# A cache hit needs the same merged chunk span, and tabix-js has not measured the cost

`blocksForRange` clamps to the linear index's lowest offset for the query start
and then merges what is left, and the chunk cache keys on the merged span, so
two overlapping pans can decode the same bytes under two keys and miss each
other.

`@gmod/bam` measured this, found that it costs real work on short-read files and
none on deep long-read data, and set it aside. tabix-js has no equivalent
measurement, so a low hit rate here is ambiguous: it may be the undersized
budget described in
[ADR 0002](../architecture-decision-records/0002-size-the-chunk-cache-above-one-query.md)
or it may be this key mismatch.

**First move is a count, not a fix:** run a pan over a dense VCF and a sparse
GFF, log the cache key per read, and see how many distinct keys cover the same
bytes. If the answer is "almost none", close this entry and remove the caveat
from [docs/caching.md](../../docs/caching.md).
