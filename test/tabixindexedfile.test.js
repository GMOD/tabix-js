const TabixIndexedFile = require('../src/tabixIndexedFile')
const VirtualOffset = require('../src/virtualOffset')

class RecordCollector {
  constructor() {
    this.clear()
    this.callback = (line, fileOffset) => {
      this.records.push({ line, fileOffset })
      this.length += 1
    }
  }
  forEach(cb) {
    this.records.forEach(cb)
  }
  clear() {
    this.records = []
    this.length = 0
  }
}
describe('tabix file', () => {
  it('can read ctgA:1000..4000', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi'),
      yieldLimit: 10,
      renameRefSeqs: n => n.replace('contig', 'ctg'),
    })
    const items = new RecordCollector()
    await f.getLines('ctgA', 1000, 4000, items.callback)
    expect(items.length).toEqual(8)
    items.forEach(({ line, fileOffset }) => {
      line = line.split('\t')
      expect(line[0]).toEqual('contigA')
      expect(parseInt(line[1], 10)).toBeGreaterThan(999)
      expect(parseInt(line[1], 10)).toBeLessThan(4001)
      expect(fileOffset).toBeGreaterThanOrEqual(0)
    })

    items.clear()
    await f.getLines('ctgA', 3000, 3000, items.callback)
    expect(items.length).toEqual(0)
    items.clear()
    await f.getLines('ctgA', 2999, 3000, items.callback)
    expect(items.length).toEqual(1)
    items.clear()
    await f.getLines('ctgA', 3000, 3001, items.callback)
    expect(items.length).toEqual(0)

    const headerString = await f.getHeader()
    expect(headerString.length).toEqual(10431)
    expect(headerString[headerString.length - 1]).toEqual('\n')

    expect(await f.getMetadata()).toEqual({
      columnNumbers: { end: 0, ref: 1, start: 2 },
      coordinateType: '1-based-closed',
      maxBlockSize: 1 << 16,
      format: 'VCF',
      metaChar: '#',
      firstDataLine: new VirtualOffset(0, 10431),
      refIdToName: ['ctgA'],
      refNameToId: { ctgA: 0 },
      skipLines: 0,
      maxBinNumber: 37449,
    })
  })
  it('can count lines with TBI', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi'),
      yieldLimit: 10,
    })
    expect(await f.lineCount('contigA')).toEqual(109)
    expect(await f.lineCount('nonexistent')).toEqual(-1)
  })
  it('can count lines with CSI', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      csiPath: require.resolve('./data/volvox.test.vcf.gz.csi'),
      yieldLimit: 10,
    })
    expect(await f.lineCount('contigA')).toEqual(109)
    expect(await f.lineCount('nonexistent')).toEqual(-1)
  })
  it("can't count lines without pseudo-bin", async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.test.vcf.gz'),
      tbiPath: require.resolve('./data/volvox.test.vcf.gz.tbi.no_pseudo'),
      yieldLimit: 10,
    })
    expect(await f.lineCount('contigA')).toEqual(-1)
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

    const headerString = await f.getHeader()
    expect(headerString[headerString.length - 1]).toEqual('\n')
    expect(headerString.length).toEqual(130)

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

    const headerString = await f.getHeader()
    expect(headerString.length).toEqual(53)
    expect(headerString[headerString.length - 1]).toEqual('\n')

    const lines = []
    await f.getLines('ctgB', 0, Infinity, l => lines.push(l))
    expect(lines.length).toEqual(0)

    await f.getLines('ctgA', -2, 3000, l => lines.push(l))
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', -50, -20, l => lines.push(l))
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', 4000, 5000, l => lines.push(l))
    expect(lines.length).toEqual(7)
    lines.length = 0
    await f.getLines('ctgA', 4370, 4371, l => lines.push(l))
    expect(lines.length).toEqual(0)
    lines.length = 0
    await f.getLines('ctgA', 4369, 4370, l => lines.push(l))
    expect(lines.length).toEqual(1)
  })

  it('can query out.gff.gz with a TBI index', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/out.gff.gz'),
    })

    const headerString = await f.getHeader()
    expect(headerString.length).toEqual(132)
    expect(headerString[headerString.length - 1]).toEqual('\n')

    expect(await f.getReferenceSequenceNames()).toEqual(['NC_000001.11'])

    let lineCount = 0
    const lines = new RecordCollector()
    await f.getLines('NC_000001.11', 30000, 55000, lines.callback)
    lines.forEach(({ line, fileOffset }) => {
      const fields = line.split('\t')
      lineCount += 1
      expect(fields[0]).toEqual('NC_000001.11')
      expect(parseInt(fields[3], 10)).toBeLessThan(55000)
      expect(parseInt(fields[4], 10)).toBeGreaterThan(3000)
      expect(fileOffset).toBeGreaterThanOrEqual(0)
    })
    expect(lineCount).toEqual(23)
    expect(lines.records[0].line).toEqual(
      'NC_000001.11	RefSeq	region	1	248956422	.	+	.	Dbxref=taxon:9606;Name=1;chromosome=1;gbkey=Src;genome=chromosome;mol_type=genomic DNA',
    )
    expect(lines.records[22].line).toEqual(
      'NC_000001.11	Gnomon	exon	53282	53959	.	+	.	Parent=lnc_RNA3;Dbxref=GeneID:105379212,Genbank:XR_948874.1;gbkey=ncRNA;gene=LOC105379212;product=uncharacterized LOC105379212;transcript_id=XR_948874.1',
    )
  })

  it('can query test.vcf.gz with a CSI index', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/test.vcf.gz'),
      csiPath: require.resolve('./data/test.vcf.gz.csi'),
    })

    const headerString = await f.getHeader()
    expect(headerString.length).toEqual(2560)
    expect(headerString[headerString.length - 1]).toEqual('\n')

    const lines = new RecordCollector()
    await f.getLines('ctgB', 0, Infinity, lines.callback)
    expect(lines.length).toEqual(0)

    await f.getLines('ctgA', -2, 3000, lines.callback)
    expect(lines.length).toEqual(0)
    await f.getLines('ctgA', -50, -20, lines.callback)
    expect(lines.length).toEqual(0)
    await f.getLines('1', 4000, 5000, lines.callback)
    expect(lines.length).toEqual(0)
    lines.clear()
    await f.getLines('1', 1206810423, 1206810423, lines.callback)
    expect(lines.length).toEqual(0)
    lines.clear()
    await expect(
      f.getLines('1', 1206808844, 12068500000, lines.callback),
    ).rejects.toThrow(/query .* is too large for current binning scheme/)
    lines.clear()
    await f.getLines('1', 1206810422, 1206810423, lines.callback)
    expect(lines.length).toEqual(1)
    expect(lines.records[0].line).toEqual(
      '1	1206810423	.	T	A	25	.	DP=19;VDB=0.0404;AF1=0.5;AC1=1;DP4=3,7,3,6;MQ=37;FQ=28;PV4=1,1,1,0.27	GT:PL:GQ	0/1:55,0,73:58',
    )
    lines.clear()
    await f.getLines('1', 1206810423, 1206810424, lines.callback)
    expect(lines.length).toEqual(0)
    await f.getLines('1', 1206810423, 1206849288, lines.callback)
    expect(lines.length).toEqual(36)
    expect(lines.records[35].line).toEqual(
      '1	1206849288	.	G	A	106	.	DP=23;VDB=0.0399;AF1=1;AC1=2;DP4=0,0,16,7;MQ=35;FQ=-96	GT:PL:GQ	1/1:139,69,0:99',
    )
    lines.clear()
    await f.getLines('1', 1206810423, 1206810424, lines.callback)
    expect(lines.length).toEqual(0)
  })

  it('can fetch the entire header for a very large vcf header', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/large_vcf_header.vcf.gz'),
    })

    const headerString = await f.getHeader()
    const lastBitOfLastHeaderLine =
      'CN_105715_AGL\tCDC_QG-1_AGL\tCDC_SB-1_AGL\n'
    expect(
      headerString.slice(
        headerString.length - lastBitOfLastHeaderLine.length,
        headerString.length,
      ),
    ).toEqual(lastBitOfLastHeaderLine)
    expect(headerString[headerString.length - 1]).toEqual('\n')
    expect(headerString.length).toEqual(5315655)
  })
})
