# How a query flows

<img src="dataflow.svg" alt="tabix-js data flow" width="700">

`getLines` turns a region into a list of BGZF chunks through the index, reads
each chunk through `chunkCache`, and scans the decompressed bytes for lines,
handing the ones that overlap the region to your callback. The header path is
separate — `getLines` never reads it. ([dataflow.dot](dataflow.dot) is the
source; see [CONTRIBUTING.md](../CONTRIBUTING.md) for how to re-render it.)

Everything orange is wasm, in
[`@gmod/bgzf-filehandle`](https://github.com/GMOD/bgzf-filehandle), and it is
only ever inflate. Both `.tbi` and `.csi` are bgzip-compressed, so unlike
`@gmod/bam` — where a `.bai` is raw bytes — every index read here goes through
it too.

The diagram is the main path only. It leaves out the header reads, the
read-ahead window that decides how far ahead of the scan chunks are fetched, and
the plain-gzip fallback `unzip` takes for non-BGZF input. The first two are in
[optimizations.md](optimizations.md), which explains why each step of this path
looks the way it does.
