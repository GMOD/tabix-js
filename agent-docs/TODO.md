---
name: todo
description: Index of the open action items in todo/, grouped by what to do first. Read when picking up work, and before filing anything new here.
---

# Todo

One file per item under [todo/](todo/). Each carries its table row in its own
frontmatter: `metadata.category` picks the table, `area` and `first_move` are
the columns, `order` is where it sits. This index has no generator, so add or
remove a row here when you add or remove an entry.

Most items are blocked on a measurement rather than on typing;
[architecture-decision-records/](architecture-decision-records/) is full of
changes that were obvious, unmeasured, and wrong.

## Needs a visual call

| Item | Area | First move |
| --- | --- | --- |
| [onProgress is coarse on a one-chunk query](todo/onprogress-coarse-on-one-chunk.md) | progress | Decide whether per-block ticks are worth the callback volume. |

## Measure first

| Item | Area | First move |
| --- | --- | --- |
| [A cache hit needs the same merged span](todo/cache-hit-needs-same-merged-span.md) | cache | Count distinct cache keys over a pan, before designing anything. |
| [Sweep the sibling parsers' docs](todo/sweep-sibling-parsers-docs.md) | docs | Grep the four wrapper repos for the same two errors. |
