# Optimizations

Why the query path looks the way it does. The path itself is drawn in
[docs/dataflow.md](docs/dataflow.md).

Most of what follows exists because a query is dominated by two things: network
round trips, and inflating more bytes than the answer needs.

**The index is parsed once and shared.** `.tbi`/`.csi` is a whole-file read,
inflated and parsed on the first query and memoized for the life of the object.
It is shared rather than merely memoized: the parse runs under a signal of its
own and is cancelled only once every caller waiting on it has given up, so a
query that pans away cannot abort the index read that concurrent queries are
depending on. `getIndices(refId)` is separately LRU-memoized so repeated lookups
don't re-walk the parsed bytes.

**The index parse allocates once, not per entry.** Finding the minimum virtual
offset visits every linear-index entry in the file — 301k of them on
`test/data/failing_tabix.vcf.gz.tbi`, against 19k bin chunks — so
`minVirtualOffset` compares packed offsets in place and allocates at most one
`VirtualOffset` instead of one per entry.

**Chunks are pruned, merged and clamped before anything is fetched.**
`blocksForRange` collects a chunk per overlapping bin at every level, which is
far more than a query reads. `optimizeChunks` drops chunks ending at or before
the linear-index floor _before_ sorting, merges neighbours within 65KB (up to a
5MB span) so adjacent bins become one range request, and trims overlaps so no
byte is fetched twice. `clampChunkEnds` then pulls each chunk's end down to the
next known BGZF block boundary rather than over-reading a full maximum-size
block — smaller fetches and a smaller `bytesForRegions` estimate, with no extra
I/O.

**Read-ahead is earned, not fixed.** Every chunk is its own range request, so a
long scan pays a round trip per chunk serially — 22 in a row for a 1Mb window on
`1kg.chr1`. But a sparse file offers chunks the scan never reaches, and
prefetching those multiplies the bytes for nothing. So the window starts at one
and doubles each time a chunk is consumed without the scan ending: a query that
stops inside its first chunk issues exactly the reads a sequential scan would,
and a long one reaches the 6-chunk cap after three. Six because that is the
HTTP/1.1 per-host connection limit browsers enforce.

**The scan stops as soon as it is past the region.** Lines are in coordinate
order, so the first line with `start >= end` ends the whole query, not just the
chunk.

**Lines are matched as bytes, and only decoded if they match.** The reference
name is compared byte-for-byte against the encoded query name, coordinates are
parsed straight out of the buffer, and `TextDecoder` runs only on lines that
survive the range test. Tab offsets go into one reused `Int32Array`. For VCF,
`END=` and `SVTYPE=TRA` are found in a single pass over the INFO field rather
than by repeated `indexOf` for bytes that produce many false positives.

The scanning itself deliberately uses `Uint8Array.indexOf` even though the scans
overlap and a hand-written single pass would touch fewer bytes. That was
measured: `indexOf` is vectorized in V8 and the single-pass replacement was up
to **2.96x slower** across nine real VCF/BED/GFF files (ADR 0003). The
byte-count argument does not predict performance here.

**The chunk cache is bounded by decompressed bytes, and sized above one query.**
We fetch compressed and cache decompressed, so entry count says nothing about
memory — a single bin of `1kg.chr1.subset.vcf.gz` is 17MB compressed and 120MB
inflated. Sizing it below one query's working set does not cache less, it caches
_nothing_: each entry is evicted before the next pan can reuse it, so the hit
rate is zero and the inflate is paid again every time. Measured on that fixture,
a six-window pan took 17 refills out of 17 at 100MB against 0 at 800MB, and
2596ms against 600ms (ADRs 0001 and 0002). The cache also shares reads already
in flight, so concurrent queries hitting one chunk inflate it once. A three
minute idle timeout is what makes the 1GB default a peak under panning rather
than a resting level, and `chunkCacheBudget` lets many files share one ceiling
instead of each holding its own.

**Both header forms come from one read.** `getHeader` and `getSkippedLines`
answer different questions but read the same leading blocks, so they are parsed
together and memoized; only the parsed results are kept, which matters for a VCF
header that runs to megabytes. `getSkippedLines` decodes only as far as the
count-th newline rather than splitting the whole buffer.

**Inflate is in wasm because that is where the time is.** libdeflate-in-wasm
beats a per-block JS inflate by 2.6-3.5x and sits at parity with native `zlib`,
so there is no faster codec to reach for; the remaining headroom is running
blocks in parallel, which is `bgzfWorkerPool`. The full argument, and why the
boundary is crossed once per chunk rather than per record, is in
[`@gmod/bam`'s ADR 0022](https://github.com/GMOD/bam-js/blob/main/agent-docs/adr/0022-the-wasm-boundary-sits-at-the-bgzf-block.md).
