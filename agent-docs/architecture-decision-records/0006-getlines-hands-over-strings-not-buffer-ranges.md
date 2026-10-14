# ADR 0006 — `getLines` hands over decoded lines, not buffer ranges

Status: Accepted (rejects the API addition)

## Context

Everything `getLines` does to find and filter a line is already byte-wise (the
tab scan, the reference-name compare and both coordinate parses), and the
`decoder.decode` at the end is the only place a string appears. A consumer that
splits that string and parses numbers back out of it therefore pays for a decode
it discards.

PR #156 proposed `lineBytesCallback`, a variant of the line callback that
receives the decompressed block and the line's `[lineStart, lineEnd)` range
instead of a string. The PR targeted jbrowse-components' MAF-tabix path, where
one BED line holds every species' alignment text, so the decoded string is
nearly the whole line and the consumer re-encodes every byte of it to a
`Uint8Array` for rendering.

## Decision

Keep the string callback as the only one.

We measured on 2026-08-16 against a checkout of the PR, in the consumer that
motivated it. `plugins/maf/benches/mafTabixBytes.bench.ts` in jbrowse-components
runs four arms from the bgzf block to the finished render buffer. Each figure is
the min of 30–40 interleaved rounds, a byte-identical control stays within 3% of
1.00 on every row, and we checked that every arm emits identical output before
trusting any timing.

| shape                     | ships today | direct read | + packed in the callback | + `lineBytesCallback` |
| ------------------------- | ----------- | ----------- | ------------------------ | --------------------- |
| 20000 blocks × 8 columns  | 0.94x       | 1.00x       | **1.18x**                | 1.17x                 |
| 1600 blocks × 250 columns | 0.92x       | 1.00x       | 0.97x                    | **1.17x**             |

**The "packed in the callback" column decides the question.** A buffer that is
valid only for the duration of the call forces the consumer to pack each line as
it arrives, instead of holding lines and packing them later. That restructure
follows from the byte handoff, and on the shape that real files have it gives
the whole speedup: 1.18x, with peak RSS falling from 491 MB to 263 MB. Adding
`lineBytesCallback` on top measured 1.17x and 265 MB, no further gain.

`lineBytesCallback` gains only where a line is wide, because the decode cost
scales with line width while the restructure's gain scales with rows. The
250-column fixture where it wins 1.17x is synthetic; jbrowse-components measures
its real MAF files at a 7bp and a 100bp median block.

The consumer got the speedup from the restructure alone, without the new API.

## Consequences

The zero-copy contract stays out of the public API. A rule like "valid only
during the call" is fine in a benchmark and expensive in a published API,
because the maintainers have to document and test it, and every future change to
the read path has to honour it, in exchange for a speedup on one shape of input.

If someone proposes it again, the number to beat is **the restructured
consumer**, not today's code. A benchmark against a consumer that still buffers
its lines credits the callback with a change the caller can make alone, and the
first proposal was measured that way.

One case remains open: a consumer whose lines are wide _and_ that already packs
as it reads. The decode takes proportionally more of the time on a 60 KB VCF
line than on a 200-byte one. That case is unmeasured, and it needs a bench arm
of its own before this ADR changes.
