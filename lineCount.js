const { TabixIndexedFile } = require('./src')

const tbiIndexed = new TabixIndexedFile({
  path: require.resolve(
    './test/extended_data/ALL.chr1.phase3_shapeit2_mvncall_integrated_v5a.20130502.genotypes.vcf.gz',
  ),
})

async function main() {
  // const start = Date.now()
  // for (let i = 35; i < 135; i += 1) {
  //   const lines = []
  //   await tbiIndexed.getLines('1', i * 500000, i * 500000 + 100000, line =>
  //     lines.push(line),
  //   )
  // }
  // console.log((Date.now() - start) / 1000, 'seconds, getLines')

  const start2 = Date.now()
  for (let i = 35; i < 135; i += 1) {
    await tbiIndexed.getLineCount('1', i * 500000, i * 500000 + 100000)
  }
  console.log((Date.now() - start2) / 1000, 'seconds, final getLineCount')
}

main()
