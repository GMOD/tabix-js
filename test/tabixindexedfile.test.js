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

    items.length = 0
    await f.getLines('contigA', 3000, 3000, items.push.bind(items))
    expect(items.length).toEqual(0)
    items.length = 0
    await f.getLines('contigA', 2999, 3000, items.push.bind(items))
    expect(items.length).toEqual(1)
    items.length = 0
    await f.getLines('contigA', 3000, 3001, items.push.bind(items))
    expect(items.length).toEqual(0)
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
    lines.length = 0
    await f.getLines('ctgB', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(4)
    lines.length = 0
    await f.getLines('ctgB', 0, 4715, l => lines.push(l))
    expect(lines.length).toEqual(4)
    lines.length = 0
    await f.getLines('ctgB', 1, 4714, l => lines.push(l))
    expect(lines.length).toEqual(3)
  })
  it('can query gvcf.vcf.gz', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/gvcf.vcf.gz'),
    })

    const lines = []
    await f.getLines('ctgB', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(0)

    await f.getLines('ctgA', -2, 3000, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', -50, -20, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', 4000, 5000, lines.push.bind(lines))
    expect(lines.length).toEqual(7)
    lines.length = 0
    await f.getLines('ctgA', 4370, 4371, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    lines.length = 0
    await f.getLines('ctgA', 4369, 4370, lines.push.bind(lines))
    expect(lines.length).toEqual(1)
  })

  it('can query test.vcf.gz with a CSI index', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/test.vcf.gz'),
      csiPath: require.resolve('./data/test.vcf.gz.csi'),
    })

    const lines = []
    await f.getLines('ctgB', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(0)

    await f.getLines('ctgA', -2, 3000, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', -50, -20, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    await f.getLines('1', 4000, 5000, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    lines.length = 0
    await f.getLines('1', 1206810423, 1206810423, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    lines.length = 0
    await f.getLines('1', 1206810422, 1206810423, lines.push.bind(lines))
    expect(lines.length).toEqual(1)
    expect(lines[0]).toEqual(
      '1	1206810423	.	T	A	25	.	DP=19;VDB=0.0404;AF1=0.5;AC1=1;DP4=3,7,3,6;MQ=37;FQ=28;PV4=1,1,1,0.27	GT:PL:GQ	0/1:55,0,73:58',
    )
    lines.length = 0
    await f.getLines('1', 1206810423, 1206810424, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
    await f.getLines('1', 1206810423, 1206849288, lines.push.bind(lines))
    expect(lines.length).toEqual(36)
    expect(lines[35]).toEqual(
      '1	1206849288	.	G	A	106	.	DP=23;VDB=0.0399;AF1=1;AC1=2;DP4=0,0,16,7;MQ=35;FQ=-96	GT:PL:GQ	1/1:139,69,0:99',
    )
    lines.length = 0
    await f.getLines('1', 1206810423, 1206810424, lines.push.bind(lines))
    expect(lines.length).toEqual(0)
  })
})
