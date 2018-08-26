const TabixIndexedFile = require('../src/tabixIndexedFile')

describe('tabix file', () => {
  it('can read ctgA:1000..4000', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi'),
      yieldLimit: 10,
    })
    const items = []
    await f.getLines('contigA', 1000, 4000, items.push.bind(items))
    expect(items.length).toEqual(8)
    items.forEach(item => {
      item = item.split('\t')
      expect(item[0]).toEqual('contigA')
      expect(parseInt(item[1], 10)).toBeGreaterThan(999)
      expect(parseInt(item[1], 10)).toBeLessThan(4001)
    })
  })
  it('can count lines', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi'),
      yieldLimit: 10,
    })
    expect(await f.lineCount('contigA')).toEqual(109)
    expect(await f.lineCount('nonexistent')).toEqual(-1)
  })
})
