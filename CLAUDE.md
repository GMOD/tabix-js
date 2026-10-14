# tabix-js

`agent-docs/architecture-decision-records/` holds the decisions where the
obvious change is wrong for a measured reason. Read them before proposing a
parser or cache optimization. ADRs 0003, 0004 and 0006 each record an idea that
someone proposed from first principles and that then failed its benchmark. Read
0006 before adding anything to the `getLines` callback contract.

## Validate index and query changes against htslib, not the unit tests

`tabix`, `bgzip`, `htsfile` (htslib 1.21) and `samtools` are on PATH. The
highest-value check in this repo compares the library with htslib. For each
`test/data/*.gz` that has an index, run randomized regions through both
`TabixIndexedFile.getLines` and `tabix <file> <ref>:<start+1>-<end>`, and
compare the output.

**The unit tests cannot catch the bugs this check finds.** They assert fixed
expectations, so an off-by-one in `reg2bins` passes them all. 1,600 randomized
queries against htslib found two bugs the suite missed: a bin-boundary skip and
an int32 end-coordinate overflow.

When you build the harness, get two things right:

- **htslib regions are 1-based and closed**, while `getLines` takes 0-based
  half-open coordinates, so the harness passes `start+1`.
- **Hash the output rather than accumulating strings.** The 1kg VCF has ~60 KB
  lines, and the string for a whole-region query exceeds V8's maximum string
  length.

Bias the region generator toward bin boundaries (multiples of 16384) and 1–2 bp
windows, where the binning math breaks. `~/src/gmod/bam-js` has a parallel
`reg2bins`/`DataView` implementation to cross-check against.

## Index parsing is not the bottleneck

When ranking performance work, don't lead with `.tbi`/`.csi` parsing. tabix-js
parses each ref's index lazily through `memoizeByRefId`, which already bounds
the index cost to five refs, so index parsing rarely dominates a query. The cost
is in the read path (chunk fetch, decompression and per-line scanning) and in
retained memory.

Cheap, safe index wins are still worth taking, but don't present one as the
headline. Verify any index change with the htslib harness above rather than the
unit tests alone.
