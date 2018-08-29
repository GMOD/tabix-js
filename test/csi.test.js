const VirtualOffset = require('../src/virtualOffset')
const CSI = require('../src/csi')
const LocalFile = require('../src/localFile')

describe('csi index', () => {
  it('loads test.gff3.gz.csi', async () => {
    const ti = new CSI(
      new LocalFile(require.resolve('./data/test.gff3.gz.csi')),
    )
    const indexData = await ti.parse()
    expect(indexData.columnNumbers.start).toEqual(4)
    expect(indexData.columnNumbers.ref).toEqual(1)
    expect(indexData.columnNumbers.end).toEqual(5)
    // console.log( ti );
    let blocks = await ti.blocksForRange('1', 1, 4000)
    expect(blocks.length).toEqual(0)
    blocks = await ti.blocksForRange('1', 0, 2000046092)
    expect(blocks.length).toEqual(1)
    expect(blocks[0].minv.blockPosition).toEqual(0)
    expect(blocks[0].minv.dataPosition).toEqual(130)
    // console.log( blocks );

    const metadata = await ti.getMetadata()
    expect(metadata).toEqual({
      columnNumbers: { end: 5, ref: 1, start: 4 },
      coordinateType: '1-based-closed',
      format: 'generic',
      firstDataLine: new VirtualOffset(0, 109),
      metaChar: '#',
      refIdToName: ['1', 'ctgB'],
      refNameToId: { 1: 0, ctgB: 1 },
      skipLines: 0,
      maxBlockSize: 1 << 16,
    })
  })
  it('loads test.gff3.gz.csi', async () => {
    const ti = new CSI(new LocalFile(require.resolve('./data/test.vcf.gz.csi')))
    const indexData = await ti.parse()
    expect(indexData.columnNumbers.start).toEqual(2)
    expect(indexData.columnNumbers.ref).toEqual(1)
    expect(indexData.columnNumbers.end).toEqual(0)
    // console.log( ti );
    let blocks = await ti.blocksForRange('1', 1, 4000)
    expect(blocks.length).toEqual(0)
    blocks = await ti.blocksForRange('1', 0, 2000046092)
    expect(blocks.length).toEqual(1)
    expect(blocks[0].minv.blockPosition).toEqual(0)
    expect(blocks[0].minv.dataPosition).toEqual(2560)
    // console.log( blocks );

    expect(await ti.lineCount('1')).toEqual(37)

    const metadata = await ti.getMetadata()
    expect(metadata).toEqual({
      columnNumbers: { end: 0, ref: 1, start: 2 },
      coordinateType: '1-based-closed',
      format: 'VCF',
      metaChar: '#',
      firstDataLine: new VirtualOffset(0, 109),
      refIdToName: ['1'],
      refNameToId: { 1: 0 },
      maxBlockSize: 1 << 16,
      skipLines: 0,
    })
  })
})
