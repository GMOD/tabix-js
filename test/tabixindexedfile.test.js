const TabixIndexedFile = require('../src/tabixIndexedFile')
const VirtualOffset = require('../src/virtualOffset')

const { extended } = require('./utils')
const LocalFile = require('../src/localFile')

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
  text() {
    return this.records.map(r => `${r.line}\n`).join('')
  }
  expectNoDuplicates() {
    const seen = {}
    this.forEach(({ line, fileOffset }) => {
      expect(seen[line]).toBe(undefined)
      seen[line] = fileOffset
    })
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
    items.expectNoDuplicates()
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
    await expect(f.getLines('foo', 32, 24, () => {})).rejects.toThrow(
      /invalid start/,
    )
    await expect(f.getLines()).rejects.toThrow(/reference/)
    await expect(f.getLines('foo', 23, 45)).rejects.toThrow(/callback/)
  })
  it('can query volvox.sort.gff3.gz.1', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/volvox.sort.gff3.gz.1'),
      tbiPath: require.resolve('./data/volvox.sort.gff3.gz.tbi'),
    })

    const headerString = await f.getHeader()
    expect(headerString[headerString.length - 1]).toEqual('\n')
    expect(headerString.length).toEqual(130)

    const lines = new RecordCollector()
    await f.getLines('ctgB', 0, Infinity, lines.callback)
    lines.expectNoDuplicates()
    expect(lines.length).toEqual(4)
    expect(lines.records[3].line).toEqual(
      'ctgB	example	remark	4715	5968	.	-	.	Name=f05;Note=ああ、この機能は、世界中を旅しています！',
    )
    lines.clear()
    await f.getLines('ctgA', 10000000, Infinity, lines.callback)
    expect(lines.length).toEqual(0)
    lines.clear()
    await f.getLines('ctgA', 0, Infinity, lines.callback)
    expect(lines.length).toEqual(237)
    lines.clear()
    await f.getLines('ctgB', 0, Infinity, lines.callback)
    expect(lines.length).toEqual(4)
    lines.clear()
    await f.getLines('ctgB', 0, 4715, lines.callback)
    expect(lines.length).toEqual(4)
    lines.clear()
    await f.getLines('ctgB', 1, 4714, lines.callback)
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
    await f.getLines('ctgA', 4383, 4384, l => lines.push(l))
    expect(lines.length).toEqual(1)
    lines.length = 0
    await f.getLines('ctgA', 4384, 4385, l => lines.push(l))
    expect(lines.length).toEqual(1)
    lines.length = 0
    await f.getLines('ctgA', 4385, 4386, l => lines.push(l))
    expect(lines.length).toEqual(1)
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
    lines.expectNoDuplicates()
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
    lines.expectNoDuplicates()
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

  it('can fetch a CNV with length defined by END in INFO field', async () => {
    const f = new TabixIndexedFile({
      path: require.resolve('./data/CNVtest.vcf.gz'),
    })

    const lines = new RecordCollector()
    await f.getLines('22', 16063470, 16063480, lines.callback)
    expect(lines.length).toEqual(1)
  })

  it('can get the correct fileOffset', async () => {
    const uncompressedVcf = new LocalFile(
      require.resolve('./data/OffsetTest.vcf'),
    )
    const { size: fileSize } = await uncompressedVcf.stat()
    const vcfData = Buffer.alloc(fileSize)
    await uncompressedVcf.read(vcfData, 0, fileSize, 0)
    const FirstLineStart = vcfData.indexOf('contigA', 0, 'utf8')
    const SecondLineStart = vcfData.indexOf(
      'contigA',
      FirstLineStart + 1,
      'utf8',
    )
    const f = new TabixIndexedFile({
      path: require.resolve('./data/OffsetTest.vcf.gz'),
    })

    const lines = new RecordCollector()
    await f.getLines('contigA', 2999, 3110, lines.callback)
    expect(lines.length).toEqual(2)
    expect(lines.records[0].fileOffset).toEqual(FirstLineStart)
    expect(lines.records[1].fileOffset).toEqual(SecondLineStart)
  })

  it('can get the correct fileOffset with CRLF line endings', async () => {
    const uncompressedVcf = new LocalFile(
      require.resolve('./data/CrlfOffsetTest.vcf'),
    )
    const { size: fileSize } = await uncompressedVcf.stat()
    const vcfData = Buffer.alloc(fileSize)
    await uncompressedVcf.read(vcfData, 0, fileSize, 0)
    const FirstLineStart = vcfData.indexOf('contigA', 0, 'utf8')
    const SecondLineStart = vcfData.indexOf(
      'contigA',
      FirstLineStart + 1,
      'utf8',
    )
    const f = new TabixIndexedFile({
      path: require.resolve('./data/CrlfOffsetTest.vcf.gz'),
    })

    const lines = new RecordCollector()
    await f.getLines('contigA', 2999, 3110, lines.callback)
    expect(lines.length).toEqual(2)
    expect(lines.records[0].fileOffset).toEqual(FirstLineStart)
    expect(lines.records[1].fileOffset).toEqual(SecondLineStart)
  })

  extended(
    'can fetch NC_000001.11:184099343..184125655 correctly',
    async () => {
      const f = new TabixIndexedFile({
        path: require.resolve('./extended_data/out.sorted.gff.gz'),
      })

      // const headerString = await f.getHeader()
      // expect(headerString).toEqual('')

      const lines = new RecordCollector()
      await f.getLines('ctgB', 0, Infinity, lines.callback)
      expect(lines.length).toEqual(0)

      await f.getLines('NC_000001.11', 184099343, 184125655, lines.callback)
      // expect there to be no duplicate lines
      lines.expectNoDuplicates()
      const text = lines.text()
      expect(text).toEqual(
        `NC_000001.11	RefSeq	region	1	248956422	.	+	.	Dbxref=taxon:9606;Name=1;chromosome=1;gbkey=Src;genome=chromosome;mol_type=genomic DNA
NC_000001.11	RefSeq	match	143184588	223558935	.	+	.	Target=NC_000001.11 143184588 223558935 +;gap_count=0;num_mismatch=0;pct_coverage=100;pct_identity_gap=100
NC_000001.11	Gnomon	exon	184112091	184112377	.	+	.	Parent=lnc_RNA1660;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	lnc_RNA	184112091	184122540	.	+	.	ID=lnc_RNA1660;Parent=gene3367;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;Name=XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;model_evidence=Supporting evidence includes similarity to: 100%25 coverage of the annotated genomic feature by RNAseq alignments%2C including 2 samples with support for all annotated introns;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	gene	184112091	184122540	.	+	.	ID=gene3367;Dbxref=GeneID:102724830;Name=LOC102724830;gbkey=Gene;gene=LOC102724830;gene_biotype=lncRNA
NC_000001.11	Gnomon	exon	184112558	184112960	.	+	.	Parent=lnc_RNA1662;Dbxref=GeneID:102724830,Genbank:XR_426875.3;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X1;transcript_id=XR_426875.3
NC_000001.11	Gnomon	exon	184112558	184112960	.	+	.	Parent=lnc_RNA1661;Dbxref=GeneID:102724830,Genbank:XR_001738324.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X3;transcript_id=XR_001738324.1
NC_000001.11	Gnomon	lnc_RNA	184112558	184122540	.	+	.	ID=lnc_RNA1662;Parent=gene3367;Dbxref=GeneID:102724830,Genbank:XR_426875.3;Name=XR_426875.3;gbkey=ncRNA;gene=LOC102724830;model_evidence=Supporting evidence includes similarity to: 100%25 coverage of the annotated genomic feature by RNAseq alignments%2C including 8 samples with support for all annotated introns;product=uncharacterized LOC102724830%2C transcript variant X1;transcript_id=XR_426875.3
NC_000001.11	Gnomon	lnc_RNA	184112558	184122540	.	+	.	ID=lnc_RNA1661;Parent=gene3367;Dbxref=GeneID:102724830,Genbank:XR_001738324.1;Name=XR_001738324.1;gbkey=ncRNA;gene=LOC102724830;model_evidence=Supporting evidence includes similarity to: 100%25 coverage of the annotated genomic feature by RNAseq alignments%2C including 2 samples with support for all annotated introns;product=uncharacterized LOC102724830%2C transcript variant X3;transcript_id=XR_001738324.1
NC_000001.11	Gnomon	exon	184112865	184112960	.	+	.	Parent=lnc_RNA1660;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	exon	184119720	184119835	.	+	.	Parent=lnc_RNA1660;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	exon	184119720	184119835	.	+	.	Parent=lnc_RNA1662;Dbxref=GeneID:102724830,Genbank:XR_426875.3;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X1;transcript_id=XR_426875.3
NC_000001.11	Gnomon	exon	184119720	184119849	.	+	.	Parent=lnc_RNA1661;Dbxref=GeneID:102724830,Genbank:XR_001738324.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X3;transcript_id=XR_001738324.1
NC_000001.11	Gnomon	exon	184120965	184121250	.	+	.	Parent=lnc_RNA1660;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	exon	184120965	184121250	.	+	.	Parent=lnc_RNA1662;Dbxref=GeneID:102724830,Genbank:XR_426875.3;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X1;transcript_id=XR_426875.3
NC_000001.11	Gnomon	exon	184120965	184121250	.	+	.	Parent=lnc_RNA1661;Dbxref=GeneID:102724830,Genbank:XR_001738324.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X3;transcript_id=XR_001738324.1
NC_000001.11	Gnomon	exon	184121787	184122540	.	+	.	Parent=lnc_RNA1660;Dbxref=GeneID:102724830,Genbank:XR_001738323.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X2;transcript_id=XR_001738323.1
NC_000001.11	Gnomon	exon	184121787	184122540	.	+	.	Parent=lnc_RNA1662;Dbxref=GeneID:102724830,Genbank:XR_426875.3;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X1;transcript_id=XR_426875.3
NC_000001.11	Gnomon	exon	184121787	184122540	.	+	.	Parent=lnc_RNA1661;Dbxref=GeneID:102724830,Genbank:XR_001738324.1;gbkey=ncRNA;gene=LOC102724830;product=uncharacterized LOC102724830%2C transcript variant X3;transcript_id=XR_001738324.1
`,
      )
    },
  )
})
