import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { TabixIndexedFile as TabixBranch1 } from '../esm_branch1/index.js'
import { TabixIndexedFile as TabixBranch2 } from '../esm_branch2/index.js'

const branch1Name = readFileSync('esm_branch1/branchname.txt', 'utf8').trim()
const branch2Name = readFileSync('esm_branch2/branchname.txt', 'utf8').trim()

function benchTabix(
  name: string,
  path: string,
  refSeq: string,
  start: number,
  end: number,
  opts?: { iterations?: number; warmupIterations?: number },
) {
  describe(name, () => {
    bench(
      branch1Name,
      async () => {
        const tbiIndexed = new TabixBranch1({ path })
        const lines: string[] = []
        await tbiIndexed.getLines(refSeq, start, end, line => {
          lines.push(line)
        })
      },
      opts,
    )

    bench(
      branch2Name,
      async () => {
        const tbiIndexed = new TabixBranch2({ path })
        const lines: string[] = []
        await tbiIndexed.getLines(refSeq, start, end, line => {
          lines.push(line)
        })
      },
      opts,
    )
  })
}

benchTabix('test.vcf.gz (2.2KB)', 'test/data/test.vcf.gz', 'ctgA', 0, 100000, {
  iterations: 5000,
  warmupIterations: 1000,
})

benchTabix(
  'volvox.filtered.vcf.gz (2.4KB)',
  'test/data/volvox.filtered.vcf.gz',
  'ctgA',
  0,
  100000,
  { iterations: 5000, warmupIterations: 1000 },
)

benchTabix(
  'volvox.test.vcf.gz (45KB)',
  'test/data/volvox.test.vcf.gz',
  'ctgA',
  0,
  100000,
  { iterations: 2000, warmupIterations: 500 },
)

benchTabix(
  'out.bed.gz (285KB)',
  'test/data/out.bed.gz',
  'ctgA',
  0,
  100000000,
  { iterations: 1000, warmupIterations: 300 },
)

benchTabix(
  'raw.g.vcf.gz (283KB)',
  'test/data/raw.g.vcf.gz',
  'chr1',
  0,
  1000000,
  { iterations: 1000, warmupIterations: 300 },
)

benchTabix(
  'large_vcf_header.vcf.gz (915KB)',
  'test/data/large_vcf_header.vcf.gz',
  'LcChr1',
  0,
  100000000,
  { iterations: 500, warmupIterations: 200 },
)

benchTabix(
  'chr22_nanopore_subset.bed.gz (3.4MB)',
  'test/data/chr22_nanopore_subset.bed.gz',
  'chr22',
  0,
  100000000,
  { iterations: 500, warmupIterations: 200 },
)

benchTabix(
  'ncbi_human.sorted.gff.gz (5.2MB)',
  'test/data/ncbi_human.sorted.gff.gz',
  'NC_000001.11',
  0,
  100000000,
  { iterations: 200, warmupIterations: 100 },
)

benchTabix(
  '1kg.chr1.subset.vcf.gz (213MB)',
  'test/data/1kg.chr1.subset.vcf.gz',
  '1',
  10000000,
  20000000,
  { iterations: 100, warmupIterations: 50 },
)
