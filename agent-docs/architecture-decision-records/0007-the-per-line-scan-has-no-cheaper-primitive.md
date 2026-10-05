# ADR 0007 — The per-line scan has no cheaper primitive

Status: Accepted (rejects the optimizations)

## Context

The backlog held the per-line scan as the last large movable part of a query,
and expected the cost to sit in `TextDecoder` on wide VCF lines. Profiled
2026-09-24 on node 24.

**Wide lines.** `1kg.chr1.subset.vcf.gz` `chr1:10000-2000000` returns 16,517
lines of ~94KB each, 1.5GB of text, which is past the 1GB chunk cache, so every
pass inflates. Inflate took ~70% of the query, the newline `indexOf` 17% and
`TextDecoder` 6.6%.

**Narrow lines.** With the cache warm on the GIANT BMI summary statistics (chr1,
189,218 lines of ~40 bytes), `getLines` spent 47% of its own time in the two
`indexOf(TAB)` calls per line. The decode took another 15% of the query.

## Decision

Keep `decoder.decode` per line and `indexOf` for every search. Each alternative
was measured per line on real lines (ada, node 24); `fromCharCode.apply`
overflows the stack on a line of tens of kilobytes, so the VCF rows have none:

| lines                  | tabs: `indexOf` | tabs: JS loop | UTF-8 decode | latin1 decode | `fromCharCode` |
| ---------------------- | --------------- | ------------- | ------------ | ------------- | -------------- |
| GWAS, 40 bytes, 2 tabs | 47 ns           | 19 ns         | 118 ns       | 158 ns        | 214 ns         |
| BED12, 106 bytes, 3    | 86 ns           | 43 ns         | 156 ns       | 209 ns        | 495 ns         |
| rmsk, 202 bytes, 3     | 89 ns           | 62 ns         | 187 ns       | 223 ns        | 772 ns         |
| volvox VCF, 17KB, 8    | 213 ns          | 56 ns         | 2.5 µs       | 3.9 µs        | too long       |
| 1kg VCF, 96KB, 8       | 900 ns          | 1124 ns       | 30.1 µs      | 39.0 µs       | too long       |

- **UTF-8 `TextDecoder` is already the fastest decode** on every shape.
- **A JS loop for the tab offsets saves 25-45ns a line on narrow files** and
  loses on the 1kg lines, whose eighth tab sits past a long INFO. jbrowse's own
  parse of a GWAS line into a feature took ~490ns on the same machine, so the
  loop is a few percent of a line there, and it gives back ADR 0003's regression
  on wide INFO.
- **The newline search is bound by the platform.** `Uint8Array.indexOf` ran
  2.6-3.8 GB/s over a buffer with no match, where node's `Buffer.indexOf`
  (memchr) ran 8.6 GB/s. A browser has no memchr to reach, and a JS loop is
  slower than `indexOf` (ADR 0003).

## Consequences

Batch-decoding a chunk and slicing lines out of it is the one untried route. It
turns every line into a slice of one large string, and a caller that keeps any
field of a line would then keep the whole batch alive. Price the retained memory
in a consumer before measuring its speed.
