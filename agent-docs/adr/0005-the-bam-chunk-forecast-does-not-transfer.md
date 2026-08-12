# ADR 0005 — `@gmod/bam`'s chunk forecast does not transfer to tabix

Status: Accepted (rejects the port). Second attempt; see "This has been tried
before" below.

## Context

`bytesForRegions` sums `optimizeChunks` over every chunk `blocksForRange`
offers. `getLines` reads far fewer than that on a sparse file: it walks the
chunks in order and `return`s at the first record whose start is past the query
end, so what it reads is a **prefix**.

`@gmod/bam` had exactly this shape and fixed it. Its `estimatedBytesForRegions`
runs `chunksLikelyRead` first, which cuts the chunk list at the linear-index
entry one window past the query, and its ADR 0017 measured the difference at
**5.6x** — 43.5MB reported against the 7.8MB a 380bp window actually reads. The
number matters because it is what a consumer's "too much data" banner reads, and
a reader cannot answer an inflated one by zooming: every window narrower than a
linear-index interval resolves to the same chunks and the same number.

The over-report is real here too. Forecast against bytes actually read, `tbi`
fixtures, one region per row:

| fixture                  | window | all chunks | actually read | ratio |
| ------------------------ | ------ | ---------- | ------------- | ----- |
| ncbi_human.sorted.gff.gz | 1kb    | 308kb      | 86kb          | 3.57x |
| ncbi_human.sorted.gff.gz | 1Mb    | 308kb      | 86kb          | 3.57x |
| CHM1_pacbio_clip2.bed.gz | whole  | 65kb       | 1kb           | 83x   |
| 1kg.chr1.subset.vcf.gz   | 1Mb    | 209703kb   | 209639kb      | 1.00x |

## Decision

**Do not port `chunksLikelyRead`.** It was implemented, measured across every
`.tbi` fixture in `test/data`, and reverted.

It is not that the port is wrong. Written with `@gmod/bam`'s empty-prefix
fallback, and with the floor dropped from `MAX_CONCURRENT_CHUNK_READS` to 1
(`getLines` starts its read-ahead at one and can return inside the first chunk,
so one chunk is the least it ever reads), it is **safe**: over the whole fixture
sweep, zero queries forecast under what they read.

It simply does not pay. Across that sweep exactly **one** row moved —
`raw.g.vcf.gz` at a 10kb window, 278kb down to 150kb, landing exactly on what
the query reads. Every other row was unchanged, including both rows above where
the over-report is worst.

## Why it cannot help where it is needed

**The linear index is pinned by a long feature, and that is the normal case for
GFF.** `ncbi_human.sorted.gff.gz` opens with

```
NC_000001.11  RefSeq  region  1  248956422  ...
```

a feature spanning the whole chromosome, at file offset 0. The linear index
entry for a window is the smallest offset of any record overlapping it, so that
one feature pins **every** entry on the reference to 0. The bound then lands at
or before the query's own first chunk, orders nothing, and the fallback
correctly returns every chunk. Every NCBI RefSeq GFF begins with that record, so
this is the representative case rather than a bad fixture.

**On a dense VCF there is nothing to forecast away.** `1kg.chr1.subset.vcf.gz`
already measures 1.00x: its bins hold few, enormous chunks and the query reads
all of them.

Those two shapes are where a consumer's byte gate actually fires, and the
forecast is powerless on both.

## Why `@gmod/bam` differs

Not a difference in the forecast — a difference in what `blocksForRange`
returns. On a deep BAM pileup a narrow window inherits every chunk of every
overlapping bin at every level, which is how ADR 0017 gets 90 chunks and 43.5MB
for a 380bp window against 6 chunks read. Tabix bins over VCF/GFF hold far fewer
chunks, and the scan's own early return already keeps the read short. The
premise the forecast needs — _a long ordered list of candidate chunks, of which
a short prefix is read_ — is a BAM property, not a tabix one.

## This has been tried before, and the earlier attempt failed differently

The first port measured **wrong**, not merely useless: on the 1000 Genomes SV
callset, whose 1.4Mb deletions pin the linear-index entry at the data start, it
forecast 0.04MB against the 0.22MB the query read. Under-forecasting is the
dangerous direction, since a consumer gate that believes it will let a query
through that it should have stopped.

That is what motivated the empty-prefix fallback now in `@gmod/bam`'s
`chunksLikelyRead`, and this attempt carried it — which is why this one is safe
where that one was not. Recording both outcomes so the next person does not have
to rediscover either: **it is safe now, and it still does not pay.**

## If someone picks this up anyway

Only with a fixture where the linear index is not pinned — meaning no
chromosome-spanning feature — and where `blocksForRange` returns a long chunk
list. If you cannot name such a file that a consumer actually loads, there is
nothing here to win.

The harness is a `bytesForRegions`-vs-`getLines` comparison with a counting
filehandle, taking both arms from one process so they cannot drift; the check
that matters is `likely >= actual` on every row.
