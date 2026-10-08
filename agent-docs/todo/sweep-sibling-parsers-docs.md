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

Two errors were found writing [docs/caching.md](../../docs/caching.md), and both
are the kind that copy across repos:

- `onProgress` was documented as firing per **block** when it fires per
  **chunk**, in the README, in `docs/api.md`, and in a source comment that
  managed to claim both in one sentence.
- `chunkCacheBudget` and `bgzfWorkerPool` were absent from the API table
  entirely — the two options that decide a genome browser's memory and its
  decompression throughput.

A third was found by comparing against the siblings rather than inside this
repo: both the API comment and `docs/caching.md` said `@gmod/cram` could join a
`chunkCacheBudget`, and it cannot — cram weighs decoded _records_ where this
library weighs bytes, so the sum bounds neither. Fixed here; `@gmod/bam` never
made the claim.

`vcf-js`, `gff-nostream`, `bed-js` and `twobit-js` wrap the same reader or the
same filehandle and plausibly carry the same omissions. Check the option tables
against the constructors rather than against each other.

**The caching-doc side of that sweep is done, and the answer was "nothing to
add"** (2026-08-16). Only three of these repos expose cache knobs at all:
`@gmod/bam` and this one, which now carry matching `docs/caching.md`, and
`@gmod/cram`, whose `cacheSize`/`cacheIdleTimeoutMs`/`cacheBudget` are covered
completely by `docs/api.md` § "The cache options" and `docs/memory.md` § "The
slice cache" — a different filename, not a gap, and moving them would break the
cross-links those two docs already have. `@gmod/bbi` and `@gmod/hic` expose
none: their caches are internal and fixed (bbi's R-tree node cache is 1000
entries, hic's block cache is a byte-bounded LRU behind two constants), so a
consumer-facing caching doc there would have nothing to document.

What that leaves in those two repos is a **code** question rather than a docs
one, and `@gmod/bbi` has already framed it: its `docs/optimizations.md` carries
a "No block cache" entry saying a pan that re-visits a window re-fetches and
re-inflates it, deliberately, because the filehandle layer above dedups the
bytes — the expensive half remotely. So this is not unexamined, and re-deriving
it from first principles is the mistake this directory exists to prevent.

What has changed is the condition that entry names. It says a parsed-block cache
"would need a byte-bounded budget shared across files, as bam-js's does, rather
than an entry count" — and that budget now ships, in `@gmod/shared-read-cache`,
which `@gmod/bbi` already depends on for its index caches. The prerequisite is
met; what is not established is whether the inflate a pan repeats is worth it,
which is bbi's measurement to make. One caveat travels with it: bbi weighs
entries today, so a byte-weighed block cache has to be its own budget group
rather than joining the one `@gmod/bam` and this library share.
