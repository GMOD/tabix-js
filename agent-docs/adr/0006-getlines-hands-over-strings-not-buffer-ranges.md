# ADR 0006 — `getLines` hands over decoded lines, not buffer ranges

Status: Accepted (rejects the API addition)

## Context

Everything `getLines` does to find and filter a line is already byte-wise — the
tab scan, the reference-name compare, both coordinate parses — and the
`decoder.decode` at the end is the only place a string appears. So a consumer
that splits that string and parses numbers back out of it pays for a decode it
discards.

PR #156 proposed `lineBytesCallback`: the same callback, handed the decompressed
block and the line's `[lineStart, lineEnd)` range instead of a string. The
consumer it was written for is jbrowse-components' MAF-tabix path, where one BED
line carries every species' alignment text, so the decoded string is nearly the
whole line and every byte of it gets re-encoded to a `Uint8Array` for rendering.

## Decision

Keep the string callback as the only one.

Measured 2026-08-16 against a checkout of the PR, in the consumer that motivated
it: `plugins/maf/benches/mafTabixBytes.bench.ts` in jbrowse-components runs four
arms from the bgzf block to the finished render buffer — min of 30–40
interleaved rounds, a byte-identical control within 3% of 1.00 on every row, and
every arm verified to emit identical output before any timing was believed.

| shape                     | ships today | direct read | + packed in the callback | + `lineBytesCallback` |
| ------------------------- | ----------- | ----------- | ------------------------ | --------------------- |
| 20000 blocks × 8 columns  | 0.94x       | 1.00x       | **1.18x**                | 1.17x                 |
| 1600 blocks × 250 columns | 0.92x       | 1.00x       | 0.97x                    | **1.17x**             |

**The third column is what settles it.** A buffer valid only for the duration of
the call means a consumer cannot hold lines and pack them later — it has to pack
each one as it arrives. That restructure is not a side effect of the byte
handoff, it is a consequence of it, and on the shape real files have it is the
whole win: 1.18x, with peak RSS falling 491 MB → 263 MB. Adding the bytes on top
of it measured 1.17x and 265 MB — nothing.

The bytes pay only where a line is wide, because that is what the decode scales
with, while the restructure scales with rows. The 250-column fixture where they
win 1.17x is synthetic; the same repo measures its real MAF files at a 7bp and a
100bp median block.

So the consumer got what the API was going to buy it, without the API.

## Consequences

The zero-copy contract stays out of the public surface. "Valid only during the
call" is the kind of rule that is fine in a benchmark and expensive in a
published API: it has to be documented, tested, and honoured by every future
change to the read path, in exchange for a win one shape wide.

If it is proposed again, the number to beat is **the restructured consumer**,
not today's code. Measuring against a consumer that still buffers its lines
credits the callback with a change the caller can make alone — which is exactly
how the first proposal read.

The exception worth naming: a consumer whose lines are genuinely wide _and_ that
already packs as it reads. A 60 KB VCF line spends proportionally more in the
decode than a 200-byte one. Nobody has measured that case, and it would need its
own bench arm before this ADR moves.
