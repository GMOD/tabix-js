import { bench, describe } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile'

describe('Overall benchmark', () => {
  bench(
    'parse 1kg.chr1.subset.vcf.gz and get chr1:10109-622047',
    async () => {
      const f = new TabixIndexedFile({
        path: require.resolve('../test/data/1kg.chr1.subset.vcf.gz'),
      })

      const lines: string[] = []
      let i = 0
      await f.getLines('chr1', 10109, 11000, line => {
        i++
      })
      //console.log(i)
    },
    { iterations: 1000 },
  )
})
