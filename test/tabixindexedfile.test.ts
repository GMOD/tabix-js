import { expect, test } from 'vitest'

import TabixIndexedFile from '../src/tabixIndexedFile.ts'
import VirtualOffset from '../src/virtualOffset.ts'

class RecordCollector {
  records: { line: string; fileOffset: number }[] = []
  callback = (line: string, fileOffset: number) => {
    this.records.push({ line, fileOffset })
  }
  constructor() {
    this.clear()
  }

  forEach(cb: (arg: { line: string; fileOffset: number }) => void) {
    for (const arg of this.records) {
      cb(arg)
    }
  }

  clear() {
    this.records = []
  }

  text() {
    return this.records.map(r => `${r.line}\n`).join('')
  }

  expectNoDuplicates() {
    const seen = {} as Record<string, number>
    for (const { line, fileOffset } of this.records) {
      expect(seen[line]).toBe(undefined)
      seen[line] = fileOffset
    }
  }
}
test('can read contigA:1000..4000', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
  })
  const items = new RecordCollector()
  await f.getLines('contigA', 1000, 4000, items.callback)
  items.expectNoDuplicates()
  expect(items.records.length).toEqual(8)
  for (const { line, fileOffset } of items.records) {
    const l = line.split('\t')
    expect(l[0]).toEqual('contigA')
    expect(Number.parseInt(l[1], 10)).toBeGreaterThan(999)
    expect(Number.parseInt(l[1], 10)).toBeLessThan(4001)
    expect(fileOffset).toBeGreaterThanOrEqual(0)
  }

  items.clear()
  await f.getLines('contigA', 3000, 3000, items.callback)
  expect(items.records.length).toEqual(0)
  items.clear()
  await f.getLines('contigA', 2999, 3000, items.callback)
  expect(items.records.length).toEqual(1)
  items.clear()
  await f.getLines('contigA', 3000, 3001, items.callback)
  expect(items.records.length).toEqual(0)

  const headerString = await f.getHeader()
  expect(headerString.length).toEqual(10_431)
  expect(headerString.at(-1)).toEqual('\n')

  expect(await f.getMetadata()).toEqual({
    columnNumbers: { end: 0, ref: 1, start: 2 },
    coordinateType: '1-based-closed',
    maxBlockSize: 1 << 16,
    format: 'VCF',
    metaChar: '#',
    firstDataLine: new VirtualOffset(0, 10_431),
    refIdToName: ['contigA'],
    refNameToId: { contigA: 0 },
    skipLines: 0,
    maxBinNumber: 37_449,
    maxRefLength: 536_870_912,
  })
})
test('can read contigA:10000', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
  })
  const items = new RecordCollector()
  await f.getLines('contigA', 10_000, undefined, items.callback)
  items.expectNoDuplicates()
  expect(items.records.length).toEqual(30)
  for (const { line, fileOffset } of items.records) {
    const l = line.split('\t')
    expect(l[0]).toEqual('contigA')
    expect(Number.parseInt(l[1], 10)).toBeGreaterThan(9999)
    expect(fileOffset).toBeGreaterThanOrEqual(0)
  }
})
test('can read contigA', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
  })
  const items = new RecordCollector()
  await f.getLines('contigA', undefined, undefined, items.callback)
  items.expectNoDuplicates()
  expect(items.records.length).toEqual(109)
  for (const { line, fileOffset } of items.records) {
    const l = line.split('\t')
    expect(l[0]).toEqual('contigA')
    expect(fileOffset).toBeGreaterThanOrEqual(0)
  }
})
test('can count lines with TBI', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi', import.meta.url).pathname,
  })
  expect(await f.lineCount('contigA')).toEqual(109)
  expect(await f.lineCount('nonexistent')).toEqual(-1)
})
test('can count lines with CSI', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    csiPath: new URL('data/volvox.test.vcf.gz.csi', import.meta.url).pathname,
  })
  expect(await f.lineCount('contigA')).toEqual(109)
  expect(await f.lineCount('nonexistent')).toEqual(-1)
})
test("can't count lines without pseudo-bin", async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.test.vcf.gz', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.test.vcf.gz.tbi.no_pseudo', import.meta.url)
      .pathname,
  })
  expect(await f.lineCount('contigA')).toEqual(-1)
})

test('can query volvox.sort.gff3.gz.1', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/volvox.sort.gff3.gz.1', import.meta.url).pathname,
    tbiPath: new URL('data/volvox.sort.gff3.gz.tbi', import.meta.url).pathname,
  })

  const headerString = await f.getHeader()
  expect(headerString.at(-1)).toEqual('\n')
  expect(headerString.length).toEqual(130)

  const lines = new RecordCollector()
  await f.getLines('ctgB', 0, Infinity, lines.callback)
  lines.expectNoDuplicates()
  expect(lines.records.length).toEqual(4)
  expect(lines.records[3].line).toEqual(
    'ctgB	example	remark	4715	5968	.	-	.	Name=f05;Note=ああ、この機能は、世界中を旅しています！',
  )
  lines.clear()
  await f.getLines('ctgA', 10_000_000, Infinity, lines.callback)
  expect(lines.records.length).toEqual(0)
  lines.clear()
  await f.getLines('ctgA', 0, Infinity, lines.callback)
  expect(lines.records.length).toEqual(237)
  lines.clear()
  await f.getLines('ctgB', 0, Infinity, lines.callback)
  expect(lines.records.length).toEqual(4)
  lines.clear()
  await f.getLines('ctgB', 0, 4715, lines.callback)
  expect(lines.records.length).toEqual(4)
  lines.clear()
  await f.getLines('ctgB', 1, 4714, lines.callback)
  expect(lines.records.length).toEqual(3)
})
test('can query gvcf.vcf.gz', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/gvcf.vcf.gz', import.meta.url).pathname,
  })

  const headerString = await f.getHeader()
  expect(headerString.length).toEqual(53)
  expect(headerString.at(-1)).toEqual('\n')

  const lines = [] as string[]
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

test('can query out.gff.gz with a TBI index', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/out.gff.gz', import.meta.url).pathname,
  })

  const headerString = await f.getHeader()
  expect(headerString.length).toEqual(0)

  expect(await f.getReferenceSequenceNames()).toEqual(['NC_000001.11'])

  let lineCount = 0
  const lines = new RecordCollector()
  await f.getLines('NC_000001.11', 30_000, 55_000, lines.callback)
  lines.expectNoDuplicates()
  for (const { line, fileOffset } of lines.records) {
    const fields = line.split('\t')
    lineCount += 1
    expect(fields[0]).toEqual('NC_000001.11')
    expect(Number.parseInt(fields[3], 10)).toBeLessThan(55_000)
    expect(Number.parseInt(fields[4], 10)).toBeGreaterThan(3000)
    expect(fileOffset).toBeGreaterThanOrEqual(0)
  }
  expect(lineCount).toEqual(23)
  expect(lines.records[0].line).toEqual(
    'NC_000001.11	RefSeq	region	1	248956422	.	+	.	Dbxref=taxon:9606;Name=1;chromosome=1;gbkey=Src;genome=chromosome;mol_type=genomic DNA',
  )
  expect(lines.records[22].line).toEqual(
    'NC_000001.11	Gnomon	exon	53282	53959	.	+	.	Parent=lnc_RNA3;Dbxref=GeneID:105379212,Genbank:XR_948874.1;gbkey=ncRNA;gene=LOC105379212;product=uncharacterized LOC105379212;transcript_id=XR_948874.1',
  )
})

test('can query test.vcf.gz with a CSI index', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/test.vcf.gz', import.meta.url).pathname,
    csiPath: new URL('data/test.vcf.gz.csi', import.meta.url).pathname,
  })

  const headerString = await f.getHeader()
  expect(headerString.length).toEqual(2560)
  expect(headerString.at(-1)).toEqual('\n')

  const lines = new RecordCollector()
  await f.getLines('ctgB', 0, Infinity, lines.callback)
  expect(lines.records.length).toEqual(0)

  await f.getLines('ctgA', -2, 3000, lines.callback)
  expect(lines.records.length).toEqual(0)
  await f.getLines('ctgA', -50, -20, lines.callback)
  expect(lines.records.length).toEqual(0)
  await f.getLines('1', 4000, 5000, lines.callback)
  expect(lines.records.length).toEqual(0)
  lines.clear()
  await f.getLines('1', 1_206_810_423, 1_206_810_423, lines.callback)
  expect(lines.records.length).toEqual(0)
  lines.clear()
  // end (12B) is clamped to maxPos; should return the same results as the bounded query below
  await f.getLines('1', 1_206_810_422, 12_068_500_000, lines.callback)
  const clampedCount = lines.records.length
  lines.clear()
  await f.getLines('1', 1_206_810_422, Infinity, lines.callback)
  expect(lines.records.length).toEqual(clampedCount)
  lines.clear()
  await f.getLines('1', 1_206_810_422, 1_206_810_423, lines.callback)
  expect(lines.records.length).toEqual(1)
  expect(lines.records[0].line).toEqual(
    '1	1206810423	.	T	A	25	.	DP=19;VDB=0.0404;AF1=0.5;AC1=1;DP4=3,7,3,6;MQ=37;FQ=28;PV4=1,1,1,0.27	GT:PL:GQ	0/1:55,0,73:58',
  )
  lines.clear()
  await f.getLines('1', 1_206_810_423, 1_206_810_424, lines.callback)
  expect(lines.records.length).toEqual(0)
  await f.getLines('1', 1_206_810_423, 1_206_849_288, lines.callback)
  lines.expectNoDuplicates()
  expect(lines.records.length).toEqual(36)
  expect(lines.records[35].line).toEqual(
    '1	1206849288	.	G	A	106	.	DP=23;VDB=0.0399;AF1=1;AC1=2;DP4=0,0,16,7;MQ=35;FQ=-96	GT:PL:GQ	1/1:139,69,0:99',
  )
  lines.clear()
  await f.getLines('1', 1_206_810_423, 1_206_810_424, lines.callback)
  expect(lines.records.length).toEqual(0)
})

test('can fetch the entire header for a very large vcf header', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/large_vcf_header.vcf.gz', import.meta.url).pathname,
  })

  const h = await f.getHeader()
  const lastBit = 'CN_105715_AGL\tCDC_QG-1_AGL\tCDC_SB-1_AGL\n'
  expect(h.slice(h.length - lastBit.length)).toEqual(lastBit)
  expect(h.at(-1)).toEqual('\n')
  expect(h.length).toEqual(5_315_655)
})

test('can fetch a CNV with length defined by END in INFO field', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/CNVtest.vcf.gz', import.meta.url).pathname,
  })

  const lines = new RecordCollector()
  await f.getLines('22', 16_063_470, 16_063_480, lines.callback)
  expect(lines.records.length).toEqual(1)
})

test('can fetch a CNV with length defined by END in INFO field using the opts.lineCallback', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/CNVtest.vcf.gz', import.meta.url).pathname,
  })

  const lines = new RecordCollector()
  await f.getLines('22', 16_063_470, 16_063_480, {
    lineCallback: lines.callback,
  })
  expect(lines.records.length).toEqual(1)
})

test('returns and empty string for `getHeader()` if there is no header', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/test.bed.gz', import.meta.url).pathname,
  })

  const headerString = await f.getHeader()
  expect(headerString).toBe('')
})

test('can fetch NC_000001.11:184099343..184125655 correctly', async () => {
  const f = new TabixIndexedFile({
    path: new URL('data/ncbi_human.sorted.gff.gz', import.meta.url).pathname,
  })

  // const headerString = await f.getHeader()
  // expect(headerString).toEqual('')

  const lines = new RecordCollector()
  await f.getLines('ctgB', 0, Infinity, lines.callback)
  expect(lines.records.length).toEqual(0)

  await f.getLines('NC_000001.11', 184_099_343, 184_125_655, lines.callback)
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
})

test('usage of the chr22 ultralong nanopore as a bed file', async () => {
  const ti = new TabixIndexedFile({
    path: new URL('data/chr22_nanopore_subset.bed.gz', import.meta.url)
      .pathname,
  })
  await ti.getHeader()
  const ret1 = new RecordCollector()
  await ti.getLines('22', 16_559_999, 16_564_499, ret1.callback)
  const ret2 = new RecordCollector()
  await ti.getLines('22', 16_564_499, 16_564_999, ret2.callback)
  const [r1, r2] = [ret1.records, ret2.records].map(x =>
    x.find(
      ({ line }) =>
        line.split('\t')[3] === '3d509937-5c54-46d7-8dec-c49c7165d2d5',
    ),
  )
  expect(r1?.fileOffset).toEqual(r2?.fileOffset)
})

test('too few', async () => {
  const ti = new TabixIndexedFile({
    path: new URL(
      'data/too_few_reads_if_chunk_merging_on.bed.gz',
      import.meta.url,
    ).pathname,
  })
  await ti.getHeader()

  const ret = new RecordCollector()
  await ti.getLines('1', 10_000, 10_600, ret.callback)
  expect(ret.records.length).toBe(34)
})

test('long read consistent IDs', async () => {
  const ti = new TabixIndexedFile({
    path: new URL('data/CHM1_pacbio_clip2.bed.gz', import.meta.url).pathname,
  })
  await ti.getHeader()
  const ret1 = new RecordCollector()
  await ti.getLines('chr1', 110_114_999, 110_117_499, ret1.callback)
  const ret2 = new RecordCollector()
  await ti.getLines('chr1', 110_117_499, 110_119_999, ret2.callback)

  const [r1, r2] = [ret1.records, ret2.records].map(x =>
    x.find(
      ({ line }) =>
        line.split('\t')[3] ===
        'm131004_105332_42213_c100572142530000001823103304021442_s1_p0/103296',
    ),
  )
  expect(r1?.fileOffset).toEqual(r2?.fileOffset)
})

test('fake large chromosome', async () => {
  const ti = new TabixIndexedFile({
    path: new URL('data/fake_large_chromosome/test.gff3.gz', import.meta.url)
      .pathname,
    csiPath: new URL(
      'data/fake_large_chromosome/test.gff3.gz.csi',
      import.meta.url,
    ).pathname,
  })
  await ti.getHeader()

  const [rangeStart, rangeEnd] = [1_000_001_055, 1_000_002_500]

  const items = new RecordCollector()
  await ti.getLines('1', rangeStart, rangeEnd, items.callback)
  expect(items.records.length).toEqual(24)
})
test('start equal to end in tabix columns', async () => {
  const ti = new TabixIndexedFile({
    path: new URL('data/out.bed.gz', import.meta.url).pathname,
    tbiPath: new URL('data/out.bed.gz.tbi', import.meta.url).pathname,
  })
  await ti.getHeader()

  const items = new RecordCollector()
  await ti.getLines('ctgA', 26_499, 26_625, items.callback)
  expect(items.records[0].line).toBe('ctgA	26499	C	21	0	21	0	0	0:11:0:0')
})
