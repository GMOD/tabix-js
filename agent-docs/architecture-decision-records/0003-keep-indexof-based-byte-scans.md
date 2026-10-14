# ADR 0003 — Keep `indexOf`-based byte scans in the line parser

Status: Accepted (rejects the optimization)

## Context

`getLines` in `tabixIndexedFile.ts` finds each line and its leading columns with
repeated `buffer.indexOf(NEWLINE)` / `buffer.indexOf(TAB)` calls. Counted in
bytes visited, the scans look wasteful: they overlap, so the parser walks the
same region up to N+1 times to find a line's first N tabs and its newline.

The obvious optimization is a single hand-written pass — one
`for (i = ...) buffer[i]` loop that records the newline and the first N tab
offsets together, visiting each byte once.

## Decision

Keep the `indexOf` calls. Do not replace them with a hand-rolled byte loop.

`Uint8Array.prototype.indexOf` is heavily optimized in V8 (almost certainly
vectorized), and a JS loop touching strictly fewer bytes still loses badly to
it.

We benchmarked on 2026-05-08 with `vitest bench` over nine real VCF/BED/GFF
files. The single-pass replacement was up to **2.96× slower** on
`volvox.test.vcf.gz` (a 45 KB VCF) and 1.27× slower on a 5.2 MB GFF, and net
worse across the suite. Two small files showed roughly 1.1×, far below the
regressions.

## Consequences

The byte-count argument does not predict performance here, so don't re-derive
this refactor from it. The first proposal came from exactly that argument.

A hand-rolled loop is still the right tool for work `indexOf` cannot express: a
multi-byte prefix match, or integer parsing. Both are already written that way
in this repo. Anything else needs a benchmark showing a win before it is worth
proposing.
