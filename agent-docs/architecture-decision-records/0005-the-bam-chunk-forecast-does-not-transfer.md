# ADR 0005 — `@gmod/bam`'s chunk forecast does not transfer to tabix

Status: Accepted (rejects the port). Second attempt; see "This has been tried
before" below.

## Context

`bytesForRegions` sums `optimizeChunks` over every chunk `blocksForRange`
offers. `getLines` reads far fewer than that on a sparse file: it walks the
chunks in order and `return`s at the first record whose start is past the query
end, so what it reads is a **prefix**.

`@gmod/bam` had the same over-count and fixed it. Its `estimatedBytesForRegions`
runs `chunksLikelyRead` first, which cuts the chunk list at the linear-index
entry one window past the query, and its ADR 0017 measured the difference at
**5.6x** — 43.5MB reported against the 7.8MB a 380bp window actually reads. The
forecast matters because a consumer's "too much data" banner shows it, and a
user cannot get under an inflated forecast by zooming in: every window narrower
than a linear-index interval maps to the same chunks and the same number.

tabix-js over-reports too. The table compares the forecast with the bytes
actually read, on `tbi` fixtures, one region per row:

| fixture                  | window | all chunks | actually read | ratio |
| ------------------------ | ------ | ---------- | ------------- | ----- |
| ncbi_human.sorted.gff.gz | 1kb    | 308kb      | 86kb          | 3.57x |
| ncbi_human.sorted.gff.gz | 1Mb    | 308kb      | 86kb          | 3.57x |
| CHM1_pacbio_clip2.bed.gz | whole  | 65kb       | 1kb           | 83x   |
| 1kg.chr1.subset.vcf.gz   | 1Mb    | 209703kb   | 209639kb      | 1.00x |

## Decision

**Do not port `chunksLikelyRead`.** We implemented it, measured it across every
`.tbi` fixture in `test/data`, and reverted it.

We wrote the port with `@gmod/bam`'s empty-prefix fallback and dropped the floor
from `MAX_CONCURRENT_CHUNK_READS` to 1, the least `getLines` ever reads, since
it starts its read-ahead at one and can return inside the first chunk. Over the
whole fixture sweep zero queries forecast under what they read, so the port is
correct and **safe**.

The port does not pay off, because exactly **one** row changed across that
sweep: `raw.g.vcf.gz` at a 10kb window went from 278kb to 150kb, exactly what
the query reads. Every other row was unchanged, including both rows above where
the over-report is worst.

## Why it cannot help where it is needed

**A long feature pins the linear index, and that is the normal case for GFF.**
`ncbi_human.sorted.gff.gz` opens with

```
NC_000001.11  RefSeq  region  1  248956422  ...
```

a feature spanning the whole chromosome, at file offset 0. The linear index
entry for a window is the smallest offset of any record overlapping it, so that
one feature pins **every** entry on the reference to 0. The bound then falls at
or before the query's first chunk, so the prefix is empty, and the fallback
correctly returns every chunk. Every NCBI RefSeq GFF begins with that record, so
this is the representative case rather than a bad fixture.

**A dense VCF has no over-report to remove.** `1kg.chr1.subset.vcf.gz` already
measures 1.00x: its bins hold few, enormous chunks and the query reads all of
them.

A consumer's byte gate fires in practice on these two kinds of file, a GFF with
a chromosome-spanning feature and a dense VCF, and the forecast changes neither.

## Why `@gmod/bam` differs

`@gmod/bam` and tabix-js forecast the same way, and differ in what
`blocksForRange` returns. On a deep BAM pileup, `blocksForRange` returns every
chunk of every overlapping bin at every level for a narrow window, which is how
bam's ADR 0017 counts 90 chunks and 43.5MB for a 380bp window against 6 chunks
read. Tabix bins over VCF/GFF hold far fewer chunks, and the early return in
`getLines` already keeps the read short. The forecast needs _a long ordered list
of candidate chunks, of which a short prefix is read_, and that list is a
property of BAM files, not of tabix ones.

## This has been tried before, and the earlier attempt failed differently

The first port measured **wrong**, not merely useless. On the 1000 Genomes SV
callset, whose 1.4Mb deletions pin the linear-index entry at the data start, it
forecast 0.04MB against the 0.22MB the query read. An under-forecast is the
dangerous direction, because a consumer gate that trusts it lets through a query
it should have stopped.

The under-forecast on the SV callset motivated the empty-prefix fallback now in
`@gmod/bam`'s `chunksLikelyRead`. The second attempt included the fallback,
which is why it is safe where the first was not. This ADR records both outcomes
so the next person does not have to rediscover either: **the port is safe now,
and it still does not pay off.**

## If someone picks this up anyway

Start only from a fixture with no chromosome-spanning feature to pin the linear
index, and where `blocksForRange` returns a long chunk list. If you cannot name
such a file that a consumer actually loads, the port has nothing to gain.

The harness compares `bytesForRegions` with `getLines` through a counting
filehandle, and runs both arms in one process so the two stay comparable. The
check that matters is `likely >= actual` on every row.
