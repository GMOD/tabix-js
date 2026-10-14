---
name: sweep-sibling-parsers-docs
description:
  Check vcf-js, gff-nostream, bed-js and twobit-js option tables against their
  constructors; bbi block-cache question remains.
metadata:
  category: measure
  area: docs
  first_move: 'Grep the four wrapper repos for the same two errors.'
  order: 2
---

# Sweep the sibling parsers for the doc gaps found here

We found two errors while writing [docs/caching.md](../../docs/caching.md), and
both are the kind that copy across repos:

- `onProgress` was documented as firing per **block** when it fires per
  **chunk**, in the README, in `docs/api.md`, and in a source comment that
  claimed both in one sentence.
- `chunkCacheBudget` and `bgzfWorkerPool` were absent from the API table
  entirely, although these two options set a genome browser's memory use and its
  decompression throughput.

We found a third by comparing against the sibling repos. The API comment and
`docs/caching.md` both said `@gmod/cram` could join a `chunkCacheBudget`, but
cram weighs decoded _records_ where this library weighs bytes, so a shared sum
bounds neither. Both are fixed here, and `@gmod/bam` never made the claim.

`vcf-js`, `gff-nostream`, `bed-js` and `twobit-js` wrap the same reader or the
same filehandle and plausibly have the same omissions. Check the option tables
against the constructors rather than against each other.

**The caching-doc side of that sweep is done, and the answer was "nothing to
add"** (2026-08-16). Only three of these repos expose cache options at all:
`@gmod/bam` and this one, which now have matching `docs/caching.md` files, and
`@gmod/cram`. cram documents `cacheSize`/`cacheIdleTimeoutMs`/`cacheBudget`
completely in `docs/api.md` § "The cache options" and `docs/memory.md` § "The
slice cache". The filename differs but nothing is missing, and moving those
sections would break the cross-links between the two docs. `@gmod/bbi` and
`@gmod/hic` expose none: their caches are internal and fixed (bbi's R-tree node
cache is 1000 entries, hic's block cache is a byte-bounded LRU behind two
constants), so a consumer-facing caching doc there would have nothing to
document.

In bbi and hic the remaining question is about **code**, not docs, and
`@gmod/bbi` has already written it down. Its `docs/optimizations.md` has a "No
block cache" entry: a pan that revisits a window re-fetches and re-inflates it
deliberately, because the filehandle layer above dedups the bytes, which are the
expensive half remotely. bbi has examined the question, and re-deriving it from
first principles is the mistake the records in this directory warn against.

The condition that entry names has since changed. The entry says a parsed-block
cache "would need a byte-bounded budget shared across files, as bam-js's does,
rather than an entry count", and that budget now ships in
`@gmod/shared-read-cache`, which `@gmod/bbi` already depends on for its index
caches. With the prerequisite met, the open question is whether caching the
inflate that a pan repeats is worth it, and bbi has to measure that. bbi weighs
entries today, so a byte-weighed block cache would need a budget group of its
own rather than joining the one that `@gmod/bam` and this library share.
