# tabix-js

`agent-docs/adr/` holds the decisions where the obvious change is wrong for a
measured reason. Read them before proposing a parser or cache optimization —
0003, 0004 and 0006 all exist because the idea was proposed from first
principles and lost to a benchmark. 0006 is also the one to read before adding
anything to the `getLines` callback contract.

## Validate index and query changes against htslib, not the unit tests

`tabix`, `bgzip`, `htsfile` (htslib 1.21) and `samtools` are on PATH. The
highest-value check in this repo is differential: for each `test/data/*.gz` that
has an index, run randomized regions through both `TabixIndexedFile.getLines`
and `tabix <file> <ref>:<start+1>-<end>`, and compare.

**The unit tests cannot catch this class of bug** — they assert fixed
expectations, so an off-by-one in `reg2bins` passes them all. 1,600 randomized
queries against htslib found two real bugs the suite missed: a bin-boundary skip
and an int32 end-coordinate overflow.

Two things to get right when building the harness:

- **htslib regions are 1-based closed**, ours are not — hence `start+1`.
- **Hash the output rather than accumulating strings.** The 1kg VCF has ~60 KB
  lines, and a whole-region query blows past V8's maximum string length.

Bias the region generator toward bin boundaries (multiples of 16384) and 1–2 bp
windows. That is where the binning math breaks. `~/src/gmod/bam-js` carries a
parallel `reg2bins`/`DataView` implementation worth cross-checking against.

## Index parsing is not the bottleneck

When ranking performance work, don't lead with `.tbi`/`.csi` parsing. Per-ref
lazy parsing via `memoizeByRefId` already bounds index cost to five refs, so
what remains is bounded and rarely dominates a query. The read path — chunk
fetch, decompress, per-line scanning — and retained memory are where the cost
is.

Cheap, safe index wins are still worth taking; just don't present one as the
headline. Verify any index change with the htslib harness above rather than the
unit tests alone.
