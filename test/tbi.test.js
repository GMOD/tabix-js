const VirtualOffset = require('../src/virtualOffset')
const TabixIndex = require('../src/tbi')
const LocalFile = require('../src/localFile')

describe('tbi index', () => {
  it('loads', async () => {
    const ti = new TabixIndex({
      filehandle: new LocalFile(
        require.resolve('./data/volvox.test.vcf.gz.tbi'),
      ),
    })
    const indexData = await ti.parse()
    expect(indexData.columnNumbers.start).toEqual(2)
    expect(indexData.columnNumbers.ref).toEqual(1)
    expect(indexData.columnNumbers.end).toEqual(0)
    // console.log( ti );
    const blocks = await ti.blocksForRange('contigA', 1, 4000)
    expect(blocks.length).toEqual(1)
    expect(blocks[0].minv.blockPosition).toEqual(0)
    expect(blocks[0].minv.dataPosition).toEqual(10431)
    // console.log( blocks );

    const metadata = await ti.getMetadata()
    expect(metadata).toEqual({
      columnNumbers: { end: 0, ref: 1, start: 2 },
      coordinateType: '1-based-closed',
      format: 'VCF',
      metaChar: '#',
      firstDataLine: new VirtualOffset(0, 109),
      refIdToName: ['contigA'],
      refNameToId: { contigA: 0 },
      maxBlockSize: 1 << 16,
      skipLines: 0,
    })
  })
})
