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
  it('handles invalid input', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi'),
      yieldLimit: 10,
    })
    let err
    const catchErr = e => {
      err = e
    }
    await f.getLines('foo', 32, 24).catch(catchErr)
    expect(err.toString()).toContain('invalid start')
    err = undefined
    await f.getLines().catch(catchErr)
    expect(err.toString()).toContain('reference')
    await f.getLines('foo', 23, 45).catch(catchErr)
    expect(err.toString()).toContain('callback')
  })
  it('can query volvox.sort.gff3.gz.1', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.sort.gff3.gz.1'),
      tbiPath: require.resolve('./data/volvox.sort.gff3.gz.tbi'),
    })

    const lines = []
    await f.getLines('ctgB', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(4)
    expect(lines[3]).toEqual(
      'ctgB	example	remark	4715	5968	.	-	.	Name=f05;Note=ああ、この機能は、世界中を旅しています！',
    )
    lines.length = 0
    await f.getLines('ctgA', 10000000, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(0)
    lines.length = 0
    await f.getLines('ctgA', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(237)
  })
})
