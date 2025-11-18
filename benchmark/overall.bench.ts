import { bench, describe } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile'

describe('Overall benchmark', () => {
  bench(
    'parse large_vcf_header.vcf.gz and get LcChr1:1-11443',
    async () => {
      const f = new TabixIndexedFile({
        path: require.resolve('../test/data/large_vcf_header.vcf.gz'),
      })

      const lines: string[] = []
      await f.getLines('LcChr1', 1, 11443, line => {
        lines.push(line)
      })
    },
    { iterations: 1000 },
  )
})
