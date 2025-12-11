import TabixIndexedFile from '../esm/tabixIndexedFile.js'

const f = new TabixIndexedFile({
  path: 'test/data/1kg.chr1.subset.vcf.gz',
})

let count = 0
await f.getLines('chr1', 50_000, 80_000, () => {
  count++
})
console.log(`Parsed ${count} lines`)
