import { readFileSync } from 'node:fs'
import { bench, describe } from 'vitest'

import { default as TabixBranch1 } from '../esm_branch1/tabixIndexedFile.js'
import { default as TabixBranch2 } from '../esm_branch2/tabixIndexedFile.js'

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
        const f = new TabixBranch1({ path })
        let i = 0
        await f.getLines(refSeq, start, end, () => {
          i++
        })
      },
      opts,
    )

    bench(
      branch2Name,
      async () => {
        const f = new TabixBranch2({ path })
        let i = 0
        await f.getLines(refSeq, start, end, () => {
          i++
        })
      },
      opts,
    )
  })
}

benchTabix(
  '1kg VCF (50k-80k)',
  'test/data/1kg.chr1.subset.vcf.gz',
  'chr1',
  50_000,
  80_000,
  {
    iterations: 5,
    warmupIterations: 1,
  },
)

benchTabix(
  'gff (0.5mbp)',
  'test/data/out.sorted.gff.gz',
  'NC_000001.11',
  1,
  500_000,
  {
    iterations: 100,
    warmupIterations: 5,
  },
)

benchTabix(
  'gff (1mbp)',
  'test/data/out.sorted.gff.gz',
  'NC_000001.11',
  1,
  1_000_000,
  {
    iterations: 100,
    warmupIterations: 5,
  },
)
