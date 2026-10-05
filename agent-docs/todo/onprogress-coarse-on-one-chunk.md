---
name: onprogress-coarse-on-one-chunk
description: A one-chunk query reports 0% then 100%; per-block ticks cost callback volume.
metadata:
  category: visual-call
  area: progress
  first_move: "Decide whether per-block ticks are worth the callback volume."
  order: 1
---

# onProgress is all-or-nothing on a query that resolves to one chunk

`getLines` ticks once per chunk, and a chunk is a run of blocks — so a query
that resolves to a single large chunk reports 0% and then 100%, which is the
case a progress bar exists for. The block boundaries are already known:
`cpositions`/`dpositions` come back from the decompressor with the buffer.

What has to be decided first is whether that is worth the callback volume. A
64KB-block file at 1MB of compressed chunk is 16 ticks where there is now 1, and
a consumer that re-renders per tick pays for all of them. A cheaper shape is to
tick per block only while a chunk exceeds some size, which keeps the common
query at one tick apiece.
